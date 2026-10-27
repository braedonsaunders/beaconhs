// Loads the full desired-state schedule snapshot for one training class and
// shapes it as a `training.class.schedule_changed` integration event. Shared
// by the web mutations (roster/schedule edits, cancel/reopen/delete) and the
// worker backfill so every path publishes byte-identical snapshots. Callers
// persist the event through the coalescing domain outbox
// (recordCoalescibleDomainEvent) inside their mutation transaction.

import { and, asc, eq, inArray } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  departments,
  people,
  tenantNotificationPolicy,
  trainingClassAttendees,
  trainingClasses,
  trainingCourses,
} from '@beaconhs/db/schema'
import { resolveClassCredit } from './class-days'
import {
  trainingClassScheduleChangedEvent,
  type TrainingClassScheduleStatus,
} from './triggers/emit'
import type { IntegrationEvent } from './types'

/** How long a burst of class edits coalesces before the snapshot publishes. */
export const TRAINING_CLASS_SCHEDULE_SYNC_DELAY_MS = 10_000

export const TRAINING_CLASS_SCHEDULE_CHANGED = 'training.class.schedule_changed'

/** The tenant's canonical class-day clock (mirrors the web class pages). */
export async function trainingClassTimeZoneFor(tx: Database, tenantId: string): Promise<string> {
  const [policy] = await tx
    .select({ timezone: tenantNotificationPolicy.scanTimezone })
    .from(tenantNotificationPolicy)
    .where(eq(tenantNotificationPolicy.tenantId, tenantId))
    .limit(1)
  return policy?.timezone ?? 'UTC'
}

/**
 * Build the snapshot event for a class that still exists in `tx`. Returns
 * null when the class (or its course) is gone. For a deleted class, call
 * this BEFORE the delete inside the same transaction with status 'deleted'
 * and record the returned event after the delete succeeds. The instructor
 * is never an attendee item.
 */
export async function loadTrainingClassScheduleEvent(
  tx: Database,
  tenantId: string,
  classId: string,
  status: TrainingClassScheduleStatus,
): Promise<IntegrationEvent | null> {
  const [cls] = await tx
    .select()
    .from(trainingClasses)
    .where(eq(trainingClasses.id, classId))
    .limit(1)
  if (!cls) return null
  const [course] = await tx
    .select({ code: trainingCourses.code, name: trainingCourses.name })
    .from(trainingCourses)
    .where(eq(trainingCourses.id, cls.courseId))
    .limit(1)
  if (!course) return null

  const timeZone = await trainingClassTimeZoneFor(tx, tenantId)
  const credit = resolveClassCredit({
    startsAt: new Date(cls.startsAt),
    endsAt: new Date(cls.endsAt),
    lengthDays: cls.lengthDays,
    hoursPerDay: cls.hoursPerDay != null ? Number(cls.hoursPerDay) : null,
    timeZone,
  })

  const roster = await tx
    .select({
      personId: people.id,
      externalEmployeeId: people.externalEmployeeId,
      firstName: people.firstName,
      lastName: people.lastName,
      departmentName: departments.name,
      status: trainingClassAttendees.status,
    })
    .from(trainingClassAttendees)
    .innerJoin(people, eq(people.id, trainingClassAttendees.personId))
    .leftJoin(departments, eq(departments.id, people.departmentId))
    .where(
      and(
        eq(trainingClassAttendees.classId, classId),
        inArray(trainingClassAttendees.status, ['registered', 'attended']),
      ),
    )
    .orderBy(asc(people.lastName), asc(people.firstName), asc(trainingClassAttendees.id))

  return trainingClassScheduleChangedEvent(tenantId, {
    classId,
    status,
    course,
    title: cls.title,
    startsAt: new Date(cls.startsAt).toISOString(),
    endsAt: new Date(cls.endsAt).toISOString(),
    classDays: credit.days,
    hoursPerDay: credit.hoursPerDay,
    lengthDays: credit.lengthDays,
    timeZone,
    attendees: roster,
  })
}
