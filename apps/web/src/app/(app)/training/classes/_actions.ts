'use server'

import { activePeopleWhere } from '@beaconhs/db'

// Server actions for the training-class record page. Inline field edits are
// local-first and go through the record saver (./_record-edits.ts); these are
// the steps that need a live connection.
//
//   cancelClass /     soft lifecycle: cancel keeps the record (audit) but marks
//   reopenClass       it off the schedule; reopen clears it. Header actions,
//                     mirroring locations archive/restore.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import {
  departments,
  people,
  tenantUsers,
  trainingClassAttendees,
  trainingClasses,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'
import { moduleFlowCommand, recordDomainEvent, recordModuleFlowEvent } from '@beaconhs/events'
import {
  DEFAULT_CREDITED_HOURS_PER_DAY,
  loadTrainingClassScheduleEvent,
  resolveClassCredit,
  trainingClassCompletedEvent,
} from '@beaconhs/integrations'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { trainingClassTimeZone } from '@/lib/training-class-settings'
import {
  recordTrainingClassScheduleSnapshot,
  syncTrainingClassSchedule,
} from '@/lib/training-class-schedule-sync'
import { dateIsoInTimeZone } from '@/lib/datetime'
import { assertClassEmailConfigured, ClassEmailError } from '@/lib/training-class-email'
import { requireUuidInput } from '@/lib/mutation-input'
import {
  MAX_TRAINING_CLASS_ATTENDEES,
  assertTrainingClassCapacity,
  parseTrainingClassCompletionPage,
  requireTrainingClassId,
} from '@/lib/training-class-policy'
import { addMonthsIso } from '../_lib/dates'

export async function emailClass(formData: FormData): Promise<{ error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  const id = requireTrainingClassId(formData.get('id'))
  try {
    await ctx.db(async (tx) => {
      const [cls] = await tx
        .select()
        .from(trainingClasses)
        .where(eq(trainingClasses.id, id))
        .limit(1)
        .for('update')
      if (!cls) throw new ClassEmailError('Class not found.')
      if (cls.cancelledAt || cls.completedAt)
        throw new ClassEmailError('Only an upcoming class can be emailed.')
      if (cls.startsAt <= new Date())
        throw new ClassEmailError('Set a future class start time before emailing the class.')
      if (cls.title === 'Untitled class')
        throw new ClassEmailError('Enter the class title before emailing the class.')
      const [roster] = await tx
        .select({ total: count() })
        .from(trainingClassAttendees)
        .where(
          and(
            eq(trainingClassAttendees.classId, id),
            inArray(trainingClassAttendees.status, ['registered', 'attended']),
          ),
        )
      if (!Number(roster?.total))
        throw new ClassEmailError('Add employees to the roster before emailing the class.')
      const txCtx = {
        ...ctx,
        db<T>(fn: (tx: Database) => Promise<T>) {
          return fn(tx)
        },
      }
      await assertClassEmailConfigured(txCtx, id, 'class_confirmed')
      const now = new Date()
      await tx
        .update(trainingClasses)
        .set({
          emailQueuedAt: now,
          emailActor: {
            userId: ctx.userId,
            membershipId:
              ctx.membership?.id === 'super-admin' ? null : (ctx.membership?.id ?? null),
            personId: ctx.personId,
            timezone: ctx.timezone,
          },
        })
        .where(eq(trainingClasses.id, id))
      await recordModuleFlowEvent(
        tx,
        { ...ctx, membership: ctx.membership?.id === 'super-admin' ? null : ctx.membership },
        {
          subjectId: id,
          moduleKey: 'training-classes',
          event: 'class_confirmed',
          occurrenceKey: randomUUID(),
        },
      )
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_class',
        entityId: id,
        action: 'export',
        summary: 'Queued class email after manager confirmation',
        after: { attendeeCount: Number(roster?.total) },
      })
    })
  } catch (error) {
    if (error instanceof ClassEmailError) return { error: error.message }
    throw error
  }
  revalidatePath(`/training/classes/${id}`)
  return {}
}

// Create a draft class and jump straight into its unified record page — no
// intermediate form. Course/date/instructor/roster are all filled in inline on
// the detail page (auto-saving fields), and completion issues the records.
// Mirrors startCourse / startTrainingRecord. courseId + title are NOT NULL, so a
// draft defaults to the first catalogue course and "Untitled class"; both are
// adjusted in place on the detail page.
export async function startClass(): Promise<void> {
  const ctx = await requireRequestContext()
  // Scheduling a class is a class-management mutation. Server actions are POST
  // endpoints, so gate here — the page render gate alone is not protection.
  assertCan(ctx, 'training.class.manage')
  const startsAt = new Date()
  const endsAt = new Date(startsAt.getTime() + 60 * 60_000)

  const newId = await ctx.db(async (tx) => {
    const [first] = await tx
      .select({ id: trainingCourses.id })
      .from(trainingCourses)
      .where(isNull(trainingCourses.deletedAt))
      .orderBy(asc(trainingCourses.name))
      .limit(1)
    if (!first) return null // no courses in the catalogue yet
    const [row] = await tx
      .insert(trainingClasses)
      .values({
        tenantId: ctx.tenantId,
        courseId: first.id,
        title: 'Untitled class',
        startsAt,
        endsAt,
        lengthDays: 1,
        hoursPerDay: String(DEFAULT_CREDITED_HOURS_PER_DAY),
      })
      .returning({ id: trainingClasses.id })
    if (row?.id) await syncTrainingClassSchedule(tx, ctx.tenantId, row.id, 'scheduled')
    return row?.id ?? null
  })

  if (!newId) {
    throw new Error('Add a course to the catalogue before scheduling a class.')
  }
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: newId,
    action: 'create',
    summary: 'Created class draft',
  })
  revalidatePath('/training/classes')
  redirect(`/training/classes/${newId}`)
}

export async function addClassAttendee(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  const classId = requireTrainingClassId(formData.get('classId'))
  const personId = requireUuidInput(formData.get('personId'), 'Person')

  await ctx.db(async (tx) => {
    const [cls] = await tx
      .select({
        capacity: trainingClasses.capacity,
        courseId: trainingClasses.courseId,
        completedAt: trainingClasses.completedAt,
        cancelledAt: trainingClasses.cancelledAt,
      })
      .from(trainingClasses)
      .where(eq(trainingClasses.id, classId))
      .limit(1)
      .for('update')
    if (!cls) throw new Error('Class not found.')
    if (cls.completedAt) throw new Error('A completed class roster cannot be changed.')
    if (cls.cancelledAt) throw new Error('Reopen the class before changing its roster.')

    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.id, personId), activePeopleWhere()))
      .limit(1)
    if (!person) throw new Error('Active person not found.')

    const [existing] = await tx
      .select({ id: trainingClassAttendees.id })
      .from(trainingClassAttendees)
      .where(
        and(
          eq(trainingClassAttendees.classId, classId),
          eq(trainingClassAttendees.personId, personId),
        ),
      )
      .limit(1)
    if (existing) throw new Error('This person is already on the class roster.')
    const [roster] = await tx
      .select({ total: count() })
      .from(trainingClassAttendees)
      .where(eq(trainingClassAttendees.classId, classId))
    assertTrainingClassCapacity(cls.capacity, Number(roster?.total ?? 0))

    const [created] = await tx
      .insert(trainingClassAttendees)
      .values({
        tenantId: ctx.tenantId,
        classId,
        personId,
        status: 'registered',
      })
      .returning({ id: trainingClassAttendees.id })
    if (!created) throw new Error('Attendee could not be added.')
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'training',
      targetRef: { courseId: cls.courseId },
    })
    await syncTrainingClassSchedule(tx, ctx.tenantId, classId, 'scheduled')
  })

  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: classId,
    action: 'update',
    summary: 'Added attendee to class',
    after: { personId },
  })
  revalidatePath(`/training/classes/${classId}`)
}

export async function removeClassAttendee(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  const classId = requireTrainingClassId(formData.get('classId'))
  const personId = requireUuidInput(formData.get('personId'), 'Person')

  await ctx.db(async (tx) => {
    const [cls] = await tx
      .select({
        courseId: trainingClasses.courseId,
        completedAt: trainingClasses.completedAt,
        cancelledAt: trainingClasses.cancelledAt,
      })
      .from(trainingClasses)
      .where(eq(trainingClasses.id, classId))
      .limit(1)
      .for('update')
    if (!cls) throw new Error('Class not found.')
    if (cls.completedAt) throw new Error('A completed class roster cannot be changed.')
    if (cls.cancelledAt) throw new Error('Reopen the class before changing its roster.')

    const [deleted] = await tx
      .delete(trainingClassAttendees)
      .where(
        and(
          eq(trainingClassAttendees.classId, classId),
          eq(trainingClassAttendees.personId, personId),
        ),
      )
      .returning({ id: trainingClassAttendees.id })
    if (!deleted) throw new Error('Roster attendee not found.')
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'training',
      targetRef: { courseId: cls.courseId },
    })
    await syncTrainingClassSchedule(tx, ctx.tenantId, classId, 'scheduled')
  })

  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: classId,
    action: 'update',
    summary: 'Removed attendee from class',
    before: { personId },
  })
  revalidatePath(`/training/classes/${classId}`)
}

function currentTenantUserId(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
): string | null {
  const id = ctx.membership?.id
  return id && id !== 'super-admin' ? id : null
}

/** Persist only the visible completion page; never infer decisions for hidden rows. */
export async function saveClassCompletionPage(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  const classId = requireTrainingClassId(formData.get('classId'))
  const decisions = parseTrainingClassCompletionPage(formData)
  const reviewedAt = new Date()
  const reviewerId = currentTenantUserId(ctx)

  await ctx.db(async (tx) => {
    const [cls] = await tx
      .select({
        courseId: trainingClasses.courseId,
        completedAt: trainingClasses.completedAt,
        cancelledAt: trainingClasses.cancelledAt,
      })
      .from(trainingClasses)
      .where(eq(trainingClasses.id, classId))
      .limit(1)
      .for('update')
    if (!cls) throw new Error('Class not found.')
    if (cls.completedAt) throw new Error('Class is already complete.')
    if (cls.cancelledAt) throw new Error('Reopen the class before reviewing completion.')

    const attendeeIds = decisions.map(({ attendeeId }) => attendeeId)
    const rows = await tx
      .select({ id: trainingClassAttendees.id })
      .from(trainingClassAttendees)
      .where(
        and(
          eq(trainingClassAttendees.classId, classId),
          inArray(trainingClassAttendees.id, attendeeIds),
        ),
      )
    if (rows.length !== decisions.length) {
      throw new Error('One or more attendees are no longer on this class roster.')
    }

    for (const decision of decisions) {
      const [updated] = await tx
        .update(trainingClassAttendees)
        .set({
          completionAttended: decision.attended,
          completionPassed: decision.passed,
          completionGrade: decision.grade,
          notes: decision.notes,
          completionReviewedAt: reviewedAt,
          completionReviewedByTenantUserId: reviewerId,
        })
        .where(
          and(
            eq(trainingClassAttendees.id, decision.attendeeId),
            eq(trainingClassAttendees.classId, classId),
          ),
        )
        .returning({ id: trainingClassAttendees.id })
      if (!updated) throw new Error('An attendee could not be saved.')
    }
  })

  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: classId,
    action: 'update',
    summary: `Reviewed completion for ${decisions.length} attendee${decisions.length === 1 ? '' : 's'}`,
    metadata: { attendeeIds: decisions.map(({ attendeeId }) => attendeeId) },
  })
  revalidatePath(`/training/classes/${classId}`)
}

/** Finalize only after every roster member has a persisted reviewed decision. */
export async function markClassComplete(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  const classId = requireTrainingClassId(formData.get('classId'))

  await ctx.db(async (tx) => {
    const [cls] = await tx
      .select()
      .from(trainingClasses)
      .where(eq(trainingClasses.id, classId))
      .limit(1)
      .for('update')
    if (!cls) throw new Error('Class not found.')
    if (cls.completedAt) throw new Error('Class is already complete.')
    if (cls.cancelledAt) throw new Error('Reopen the class before marking completion.')

    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, cls.courseId))
      .limit(1)
    if (!course) throw new Error('The class course no longer exists.')

    const roster = await tx
      .select({
        attendeeId: trainingClassAttendees.id,
        personId: people.id,
        externalEmployeeId: people.externalEmployeeId,
        firstName: people.firstName,
        lastName: people.lastName,
        departmentName: departments.name,
        attended: trainingClassAttendees.completionAttended,
        passed: trainingClassAttendees.completionPassed,
        grade: trainingClassAttendees.completionGrade,
        reviewedAt: trainingClassAttendees.completionReviewedAt,
      })
      .from(trainingClassAttendees)
      .innerJoin(people, eq(people.id, trainingClassAttendees.personId))
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .where(eq(trainingClassAttendees.classId, classId))
      .orderBy(asc(people.lastName), asc(people.firstName), asc(trainingClassAttendees.id))

    if (roster.length === 0) throw new Error('Add attendees before marking completion.')
    if (roster.length > MAX_TRAINING_CLASS_ATTENDEES) {
      throw new Error(`A class can have at most ${MAX_TRAINING_CLASS_ATTENDEES} attendees.`)
    }
    const unreviewed = roster.filter(
      (row) => row.reviewedAt == null || row.attended == null || row.passed == null,
    )
    if (unreviewed.length > 0) {
      throw new Error(
        `Review all attendees before marking completion (${unreviewed.length} remaining).`,
      )
    }

    const [existingRecord] = await tx
      .select({ id: trainingRecords.id })
      .from(trainingRecords)
      .where(and(eq(trainingRecords.classId, classId), isNull(trainingRecords.deletedAt)))
      .limit(1)
    if (existingRecord) {
      throw new Error(
        'This class already has active training records and cannot be finalized again.',
      )
    }

    // The credential date is the last actual class day (weekdays only), so a
    // multi-day class entered with one day's clock times still completes on
    // its final weekday. Days and credited hours come from the shared helper.
    const classTimeZone = await trainingClassTimeZone(tx, ctx.tenantId)
    const credit = resolveClassCredit({
      startsAt: new Date(cls.startsAt),
      endsAt: new Date(cls.endsAt),
      lengthDays: cls.lengthDays,
      hoursPerDay: cls.hoursPerDay != null ? Number(cls.hoursPerDay) : null,
      timeZone: classTimeZone,
    })
    const completedOn = credit.days.at(-1) ?? dateIsoInTimeZone(cls.endsAt, classTimeZone)
    const expiresOn = course.validForMonths
      ? addMonthsIso(completedOn, course.validForMonths)
      : null
    const passed = roster.filter((row) => row.passed === true)
    if (passed.length > 0) {
      await tx.insert(trainingRecords).values(
        passed.map((row) => ({
          tenantId: ctx.tenantId,
          personId: row.personId,
          courseId: course.id,
          source: 'class' as const,
          classId,
          grade: row.grade,
          completedOn,
          expiresOn,
          issuedByTenantUserId: currentTenantUserId(ctx),
        })),
      )
    }

    const attendedIds = roster.filter((row) => row.attended === true).map((row) => row.attendeeId)
    const noShowIds = roster.filter((row) => row.attended === false).map((row) => row.attendeeId)
    if (attendedIds.length > 0) {
      await tx
        .update(trainingClassAttendees)
        .set({ status: 'attended' })
        .where(inArray(trainingClassAttendees.id, attendedIds))
    }
    if (noShowIds.length > 0) {
      await tx
        .update(trainingClassAttendees)
        .set({ status: 'no_show' })
        .where(inArray(trainingClassAttendees.id, noShowIds))
    }

    const completedAt = new Date()
    const [updatedClass] = await tx
      .update(trainingClasses)
      .set({ completedAt })
      .where(and(eq(trainingClasses.id, classId), isNull(trainingClasses.completedAt)))
      .returning({ id: trainingClasses.id })
    if (!updatedClass) throw new Error('Class could not be marked complete.')

    const startsAt = new Date(cls.startsAt)
    const endsAt = new Date(cls.endsAt)
    const { lengthDays, hoursPerDay, totalHours } = credit
    // The internal instructor is credited like an attendee (legacy timesheet
    // behaviour) when they resolve to an active person with an employee id.
    const [instructorPerson] = cls.instructorTenantUserId
      ? await tx
          .select({
            personId: people.id,
            externalEmployeeId: people.externalEmployeeId,
            firstName: people.firstName,
            lastName: people.lastName,
            departmentName: departments.name,
          })
          .from(people)
          .innerJoin(tenantUsers, eq(tenantUsers.userId, people.userId))
          .leftJoin(departments, eq(departments.id, people.departmentId))
          .where(and(eq(tenantUsers.id, cls.instructorTenantUserId), activePeopleWhere()))
          .limit(1)
      : []
    await recordDomainEvent(tx, {
      tenantId: ctx.tenantId,
      eventType: 'training.class.completed',
      subjectId: classId,
      dedupKey: `training.class.completed:${classId}`,
      payload: {
        integration: trainingClassCompletedEvent(ctx.tenantId, {
          classId,
          course: { code: course.code, name: course.name },
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          hoursPerDay,
          lengthDays,
          timeZone: ctx.timezone,
          instructor:
            instructorPerson?.externalEmployeeId != null &&
            instructorPerson.externalEmployeeId !== ''
              ? {
                  ...instructorPerson,
                  attended: true,
                  hours: totalHours,
                }
              : null,
          attendees: roster.map((person) => ({
            personId: person.personId,
            externalEmployeeId: person.externalEmployeeId,
            firstName: person.firstName,
            lastName: person.lastName,
            departmentName: person.departmentName,
            attended: person.attended === true,
            hours: person.attended === true ? totalHours : 0,
          })),
        }),
        web: moduleFlowCommand(ctx, {
          subjectId: classId,
          moduleKey: 'training-classes',
          event: 'status_change',
          toStatus: 'completed',
        }),
      },
    })

    const completion = {
      total: roster.length,
      attended: attendedIds.length,
      passed: passed.length,
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_class',
      entityId: classId,
      action: 'update',
      summary: 'Marked class complete',
      after: completion,
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'training',
      targetRef: { courseId: course.id },
    })
    return completion
  })
  revalidatePath(`/training/classes/${classId}`)
  revalidatePath('/training/classes')
  revalidatePath('/training')
}

export async function cancelClass(id: string, _formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  id = requireTrainingClassId(id)
  await ctx.db(async (tx) => {
    const [cls] = await tx
      .select({
        courseId: trainingClasses.courseId,
        completedAt: trainingClasses.completedAt,
        cancelledAt: trainingClasses.cancelledAt,
      })
      .from(trainingClasses)
      .where(eq(trainingClasses.id, id))
      .limit(1)
      .for('update')
    if (!cls) throw new Error('Class not found.')
    if (cls.completedAt) throw new Error('A completed class cannot be cancelled.')
    if (cls.cancelledAt) throw new Error('Class is already cancelled.')
    const [updated] = await tx
      .update(trainingClasses)
      .set({ cancelledAt: new Date() })
      .where(and(eq(trainingClasses.id, id), isNull(trainingClasses.completedAt)))
      .returning({ id: trainingClasses.id })
    if (!updated) throw new Error('Class could not be cancelled.')
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'training',
      targetRef: { courseId: cls.courseId },
    })
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'training-classes',
      event: 'status_change',
      toStatus: 'cancelled',
      occurrenceKey: randomUUID(),
    })
    await syncTrainingClassSchedule(tx, ctx.tenantId, id, 'cancelled')
  })
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: id,
    action: 'update',
    summary: 'Cancelled training class',
  })
  revalidatePath(`/training/classes/${id}`)
  revalidatePath('/training/classes')
}

export async function reopenClass(id: string, _formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  id = requireTrainingClassId(id)
  await ctx.db(async (tx) => {
    const [cls] = await tx
      .select({
        courseId: trainingClasses.courseId,
        completedAt: trainingClasses.completedAt,
        cancelledAt: trainingClasses.cancelledAt,
      })
      .from(trainingClasses)
      .where(eq(trainingClasses.id, id))
      .limit(1)
      .for('update')
    if (!cls) throw new Error('Class not found.')
    if (cls.completedAt) throw new Error('A completed class cannot be reopened.')
    if (!cls.cancelledAt) throw new Error('Class is not cancelled.')
    const [updated] = await tx
      .update(trainingClasses)
      .set({ cancelledAt: null })
      .where(and(eq(trainingClasses.id, id), isNull(trainingClasses.completedAt)))
      .returning({ id: trainingClasses.id })
    if (!updated) throw new Error('Class could not be reopened.')
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'training',
      targetRef: { courseId: cls.courseId },
    })
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'training-classes',
      event: 'status_change',
      toStatus: 'scheduled',
      occurrenceKey: randomUUID(),
    })
    await syncTrainingClassSchedule(tx, ctx.tenantId, id, 'scheduled')
  })
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: id,
    action: 'update',
    summary: 'Reopened training class',
  })
  revalidatePath(`/training/classes/${id}`)
  revalidatePath('/training/classes')
}

// Hard delete (attendees cascade). Blocked once the class has issued training
// records — those are protected (FK restrict); cancel such a class instead.
export async function deleteClass(id: string, _formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.class.manage')
  id = requireTrainingClassId(id)
  await ctx.db(async (tx) => {
    const [cls] = await tx
      .select({ completedAt: trainingClasses.completedAt, courseId: trainingClasses.courseId })
      .from(trainingClasses)
      .where(eq(trainingClasses.id, id))
      .limit(1)
      .for('update')
    if (!cls) throw new Error('Class not found.')
    if (cls.completedAt) throw new Error('A completed class cannot be deleted.')
    const [rec] = await tx
      .select({ id: trainingRecords.id })
      .from(trainingRecords)
      .where(eq(trainingRecords.classId, id))
      .limit(1)
    if (rec) {
      throw new Error('This class has issued training records — cancel it instead of deleting.')
    }
    // Snapshot before the delete (the roster is about to cascade away);
    // record it after, so destinations remove the class from their copy.
    const deletedSnapshot = await loadTrainingClassScheduleEvent(tx, ctx.tenantId, id, 'deleted')
    const [deleted] = await tx
      .delete(trainingClasses)
      .where(eq(trainingClasses.id, id))
      .returning({ id: trainingClasses.id })
    if (!deleted) throw new Error('Class could not be deleted.')
    await recordTrainingClassScheduleSnapshot(tx, ctx.tenantId, deletedSnapshot)
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'training',
      targetRef: { courseId: cls.courseId },
    })
  })
  await recordAudit(ctx, {
    entityType: 'training_class',
    entityId: id,
    action: 'delete',
    summary: 'Deleted training class',
  })
  revalidatePath('/training/classes')
  redirect('/training/classes')
}
