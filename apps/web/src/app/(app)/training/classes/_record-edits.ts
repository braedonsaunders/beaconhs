// The `training-classes` record saver: inline edits on a training class,
// queued on the device by the class page and applied by /api/records/sync
// (see lib/record-sync). Same rules the inline editor has always had — the
// `training.class.manage` permission, completed classes are final and
// cancelled ones must be reopened first, the course must be live, the site a
// site, the instructor an active user, the schedule ordered, capacity never
// below the roster, reminders only with a working reminder email flow, one
// audit entry per changed field — plus a compare-and-set against the value
// the device last saw.
//
// Ops: the class columns, and `schedule` — start and end edited together as
// `{ startsAt, endsAt }` wall-clock values in the worker's timezone.

import { and, count, eq, isNull } from 'drizzle-orm'
import { activeTenantUsersWhere, type Database } from '@beaconhs/db'
import {
  orgUnits,
  tenantUsers,
  trainingClassAttendees,
  trainingClasses,
  trainingCourses,
} from '@beaconhs/db/schema'
import { materializeEvidenceTargetsObligations } from '@beaconhs/compliance'
import { can, type RequestContext } from '@beaconhs/tenant'
import { datetimeLocalValue } from '@/lib/datetime'
import type { RecordSyncPatch } from '@/lib/offline-drafts/protocol'
import {
  auditFieldChanges,
  defineRecordSaver,
  recordLocked,
  recordNotFound,
  recordOp,
  RecordSyncError,
  type ErasedRecordOp,
  type RecordSaver,
} from '@/lib/record-sync/edits'
import { assertClassEmailConfigured, ClassEmailError } from '@/lib/training-class-email'
import {
  TRAINING_CLASS_MUTABLE_FIELDS,
  parseTrainingClassField,
  type ParsedTrainingClassField,
  type TrainingClassMutableField,
} from '@/lib/training-class-policy'

type ClassRow = typeof trainingClasses.$inferSelect
type FieldValue = ParsedTrainingClassField['value']

function isField(op: string): op is TrainingClassMutableField {
  return (TRAINING_CLASS_MUTABLE_FIELDS as readonly string[]).includes(op)
}

function currentValue(row: ClassRow, field: TrainingClassMutableField): FieldValue {
  return field === 'schedule' ? { startsAt: row.startsAt, endsAt: row.endsAt } : row[field]
}

/** The wire value the class page shows for a field. */
function formatValue(
  field: TrainingClassMutableField,
  value: FieldValue,
  timeZone: string,
): string | { startsAt: string; endsAt: string } {
  if (field === 'schedule') {
    const range = value as { startsAt: Date; endsAt: Date }
    return {
      startsAt: datetimeLocalValue(range.startsAt, timeZone),
      endsAt: datetimeLocalValue(range.endsAt, timeZone),
    }
  }
  return value == null ? '' : String(value)
}

function columnPatch(
  field: TrainingClassMutableField,
  value: FieldValue,
): Partial<typeof trainingClasses.$inferInsert> {
  return field === 'schedule'
    ? (value as { startsAt: Date; endsAt: Date })
    : ({ [field]: value } as Partial<typeof trainingClasses.$inferInsert>)
}

async function assertCourseAvailable(tx: Database, courseId: string): Promise<void> {
  const [course] = await tx
    .select({ id: trainingCourses.id })
    .from(trainingCourses)
    .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
    .limit(1)
  if (!course) throw new Error('Course not found.')
}

async function assertSite(tx: Database, siteId: string): Promise<void> {
  const [site] = await tx
    .select({ id: orgUnits.id })
    .from(orgUnits)
    .where(and(eq(orgUnits.id, siteId), eq(orgUnits.level, 'site'), isNull(orgUnits.deletedAt)))
    .limit(1)
  if (!site) throw new Error('Site not found.')
}

async function assertActiveInstructor(tx: Database, tenantUserId: string): Promise<void> {
  const [instructor] = await tx
    .select({ id: tenantUsers.id })
    .from(tenantUsers)
    .where(and(eq(tenantUsers.id, tenantUserId), activeTenantUsersWhere()))
    .limit(1)
  if (!instructor) throw new Error('Instructor not found.')
}

async function assertCapacityFitsRoster(
  tx: Database,
  classId: string,
  capacity: number,
): Promise<void> {
  const [roster] = await tx
    .select({ total: count() })
    .from(trainingClassAttendees)
    .where(eq(trainingClassAttendees.classId, classId))
  if (Number(roster?.total ?? 0) > capacity) {
    throw new Error('Maximum attendees cannot be lower than the current roster size.')
  }
}

function classOp(
  tx: Database,
  ctx: RequestContext,
  row: ClassRow,
  field: TrainingClassMutableField,
  reminderEmailProblem: string | null,
): ErasedRecordOp {
  return recordOp<FieldValue>({
    current: currentValue(row, field),
    parse: async (wire) => {
      const { value } = parseTrainingClassField(field, wire, ctx.timezone)
      if (field === 'courseId' && value !== row.courseId) {
        await assertCourseAvailable(tx, value as string)
      }
      if (field === 'siteOrgUnitId' && value) await assertSite(tx, value as string)
      if (field === 'instructorTenantUserId' && value) {
        await assertActiveInstructor(tx, value as string)
      }
      if (field === 'capacity' && value != null) {
        await assertCapacityFitsRoster(tx, row.id, value as number)
      }
      if (field === 'reminderHours' && value !== null && reminderEmailProblem) {
        throw new Error(reminderEmailProblem)
      }
      return value
    },
    format: (value) => formatValue(field, value, ctx.timezone),
    write: async (value) => {
      const patch = columnPatch(field, value)
      await tx
        .update(trainingClasses)
        .set(patch)
        .where(
          and(
            eq(trainingClasses.id, row.id),
            eq(trainingClasses.tenantId, ctx.tenantId),
            isNull(trainingClasses.completedAt),
          ),
        )
      Object.assign(row, patch)
    },
  })
}

function trainingClassSpec(reminderEmailProblem: string | null) {
  return defineRecordSaver<ClassRow>('training-classes', {
    authorize: (ctx) => can(ctx, 'training.class.manage'),
    async load(tx, ctx, classId) {
      const [row] = await tx
        .select()
        .from(trainingClasses)
        .where(and(eq(trainingClasses.id, classId), eq(trainingClasses.tenantId, ctx.tenantId)))
        .limit(1)
        .for('update')
      if (!row) throw recordNotFound()
      // A completed class issued its training records and can never reopen.
      if (row.completedAt) throw new RecordSyncError('closed', 'Class is complete.')
      if (row.cancelledAt) throw recordLocked('Reopen the class before changing its details.')
      return row
    },
    resolve: (tx, ctx, row, op) =>
      isField(op) ? classOp(tx, ctx, row, op, reminderEmailProblem) : null,
    afterWrites: async (tx, ctx, row, changes) => {
      await auditFieldChanges(tx, ctx, { entityType: 'training_class', entityId: row.id }, changes)
      const changedCourse = changes.find((change) => change.op === 'courseId')
      if (changedCourse || changes.some((change) => change.op === 'schedule')) {
        const courseIds = new Set([row.courseId])
        if (typeof changedCourse?.before === 'string') courseIds.add(changedCourse.before)
        await materializeEvidenceTargetsObligations(
          tx,
          ctx.tenantId,
          [...courseIds].map((courseId) => ({ sourceModule: 'training', targetRef: { courseId } })),
        )
      }
    },
    revalidate: (classId) => [`/training/classes/${classId}`, '/training/classes'],
  })
}

const UNAVAILABLE = {
  ok: false,
  reason: 'unavailable',
  error: 'Unable to save right now.',
} as const

function turnsOnReminder(patches: readonly RecordSyncPatch[]): boolean {
  const patch = patches.find((candidate) => candidate.fieldId === 'reminderHours')
  return patch !== undefined && patch.value !== '' && patch.value != null
}

export const trainingClassRecordSaver: RecordSaver = async (ctx, classId, patches) => {
  // Turning reminders on needs an enabled reminder email flow. The check
  // evaluates the tenant's flows against the class (its own reads), so it runs
  // before the edit transaction; the saver refuses the field when it fails.
  let reminderEmailProblem: string | null = null
  if (can(ctx, 'training.class.manage') && turnsOnReminder(patches)) {
    try {
      await assertClassEmailConfigured(ctx, classId, 'class_reminder')
    } catch (error) {
      if (!(error instanceof ClassEmailError)) {
        console.error('[record-sync] training-classes reminder check failed', error)
        return UNAVAILABLE
      }
      reminderEmailProblem = error.message
    }
  }
  return trainingClassSpec(reminderEmailProblem)(ctx, classId, patches)
}
