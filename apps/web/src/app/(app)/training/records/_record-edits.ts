// The `training-records` record saver: inline field edits on a certificate,
// queued on the device by the record page and applied by /api/records/sync
// (see lib/record-sync). Same rules the inline editor has always had — the
// `training.record.create` permission, revoked records are read-only, the
// person must be active and the course live, expiry never before completion,
// one audit entry per changed field, and course compliance refreshed for the
// old and new course — plus a compare-and-set against the value the device
// last saw.

import { and, eq, isNull } from 'drizzle-orm'
import { activePeopleWhere, type Database } from '@beaconhs/db'
import { people, trainingCourses, trainingRecords } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'
import type { RecordSyncPatch } from '@/lib/offline-drafts/protocol'
import {
  auditFieldChanges,
  defineRecordSaver,
  recordNotFound,
  recordOp,
  RecordSyncError,
  type ErasedRecordOp,
  type RecordSaver,
} from '@/lib/record-sync/edits'
import { settledPartnerDate } from '../_lib/record-date-order'
import { materializeCourseEvidence } from './_course-evidence'
import {
  assertTrainingRecordDateOrder,
  parseTrainingRecordFieldUpdate,
  type TrainingRecordFieldUpdate,
} from './_mutation-input'

type TrainingRecordRow = typeof trainingRecords.$inferSelect
type Field = TrainingRecordFieldUpdate['field']
type FieldValue<F extends Field> = Extract<TrainingRecordFieldUpdate, { field: F }>['value']

type Loaded = {
  row: TrainingRecordRow
  /** The course before this batch: a retarget refreshes both courses. */
  originalCourseId: string | null
}

const FIELDS: readonly Field[] = [
  'personId',
  'courseId',
  'source',
  'completedOn',
  'expiresOn',
  'grade',
  'instructor',
  'details',
  'notes',
]

/** Changes to these refresh course compliance (who holds which course, and until when). */
const EVIDENCE_FIELDS: ReadonlySet<string> = new Set([
  'personId',
  'courseId',
  'completedOn',
  'expiresOn',
])

function isField(op: string): op is Field {
  return (FIELDS as readonly string[]).includes(op)
}

function parseField<F extends Field>(field: F, wire: unknown): FieldValue<F> {
  return parseTrainingRecordFieldUpdate(field, wire).value as FieldValue<F>
}

/** The wire value each field's live input shows ('' for empty). */
function formatField(value: string | number | null): string {
  return value == null ? '' : String(value)
}

async function assertActivePerson(tx: Database, personId: string): Promise<void> {
  const [person] = await tx
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.id, personId), activePeopleWhere()))
    .limit(1)
  if (!person) throw new Error('The selected person is not active in this workspace.')
}

async function assertLiveCourse(tx: Database, courseId: string): Promise<void> {
  const [course] = await tx
    .select({ id: trainingCourses.id })
    .from(trainingCourses)
    .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
    .limit(1)
  if (!course) throw new Error('The selected course is not available in this workspace.')
}

function fieldOp(
  tx: Database,
  ctx: RequestContext,
  row: TrainingRecordRow,
  patches: readonly RecordSyncPatch[],
  field: Field,
): ErasedRecordOp {
  const partner = (other: 'completedOn' | 'expiresOn') =>
    settledPartnerDate({
      patch: patches.find((patch) => patch.fieldId === other),
      current: row[other],
      parse: (wire) => parseField(other, wire),
    })
  return recordOp<string | number | null>({
    current: row[field],
    parse: async (wire) => {
      const value = parseField(field, wire)
      if (field === 'personId' && value !== row.personId) {
        await assertActivePerson(tx, value as string)
      }
      if (field === 'courseId' && value !== row.courseId) {
        await assertLiveCourse(tx, value as string)
      }
      // Validate against the partner date as it will stand after this batch.
      if (field === 'completedOn') {
        assertTrainingRecordDateOrder(value as string, partner('expiresOn'))
      }
      if (field === 'expiresOn') {
        assertTrainingRecordDateOrder(partner('completedOn') ?? row.completedOn, value as string)
      }
      return value
    },
    format: formatField,
    write: async (value) => {
      await tx
        .update(trainingRecords)
        .set({ [field]: value })
        .where(
          and(
            eq(trainingRecords.id, row.id),
            eq(trainingRecords.tenantId, ctx.tenantId),
            isNull(trainingRecords.deletedAt),
          ),
        )
      Object.assign(row, { [field]: value })
    },
  })
}

function trainingRecordSpec(patches: readonly RecordSyncPatch[]) {
  return defineRecordSaver<Loaded>('training-records', {
    authorize: (ctx) => can(ctx, 'training.record.create'),
    async load(tx, ctx, recordId) {
      const [row] = await tx
        .select()
        .from(trainingRecords)
        .where(and(eq(trainingRecords.id, recordId), eq(trainingRecords.tenantId, ctx.tenantId)))
        .limit(1)
        .for('update')
      if (!row) throw recordNotFound()
      // Revoking is permanent (a renewal mints a new record), so edits queued
      // on a device can never apply again.
      if (row.deletedAt) {
        throw new RecordSyncError('closed', 'Revoked training records cannot be edited.')
      }
      return { row, originalCourseId: row.courseId }
    },
    resolve: (tx, ctx, { row }, op) => (isField(op) ? fieldOp(tx, ctx, row, patches, op) : null),
    async afterWrites(tx, ctx, { row, originalCourseId }, changes) {
      await auditFieldChanges(tx, ctx, { entityType: 'training_record', entityId: row.id }, changes)
      if (changes.some((change) => EVIDENCE_FIELDS.has(change.op))) {
        await materializeCourseEvidence(tx, ctx.tenantId, [originalCourseId, row.courseId])
      }
    },
    revalidate: (recordId) => [`/training/records/${recordId}`, '/training/records'],
  })
}

export const trainingRecordSaver: RecordSaver = (ctx, recordId, patches) =>
  trainingRecordSpec(patches)(ctx, recordId, patches)
