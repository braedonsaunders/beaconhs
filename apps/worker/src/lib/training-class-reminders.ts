import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { trainingClasses, trainingClassAttendees, auditLog } from '@beaconhs/db/schema'
import { recordModuleFlowEvent } from '@beaconhs/events'

/** Claims and records the reminder atomically; the existing outbox delivers it. */
export async function scanTrainingClassReminders(now = new Date()): Promise<number> {
  const candidates = await withSuperAdmin(db, (tx) =>
    tx
      .select({ id: trainingClasses.id, tenantId: trainingClasses.tenantId })
      .from(trainingClasses)
      .where(
        and(
          isNotNull(trainingClasses.emailQueuedAt),
          isNotNull(trainingClasses.emailActor),
          isNotNull(trainingClasses.reminderHours),
          isNull(trainingClasses.cancelledAt),
          isNull(trainingClasses.completedAt),
          gt(trainingClasses.startsAt, now),
          lte(
            sql`${trainingClasses.startsAt} - ${trainingClasses.reminderHours} * interval '1 hour'`,
            now,
          ),
          or(
            isNull(trainingClasses.reminderQueuedFor),
            sql`${trainingClasses.reminderQueuedFor} <> ${trainingClasses.startsAt}`,
          ),
          sql`exists (select 1 from ${trainingClassAttendees} where ${trainingClassAttendees.tenantId} = ${trainingClasses.tenantId} and ${trainingClassAttendees.classId} = ${trainingClasses.id} and ${trainingClassAttendees.status} in ('registered', 'attended'))`,
        ),
      )
      .orderBy(trainingClasses.startsAt, trainingClasses.id)
      .limit(100),
  )
  let queued = 0
  for (const candidate of candidates) {
    queued += await withTenant(db, candidate.tenantId, async (tx) => {
      const [cls] = await tx
        .select()
        .from(trainingClasses)
        .where(eq(trainingClasses.id, candidate.id))
        .limit(1)
        .for('update')
      if (
        !cls?.emailQueuedAt ||
        !cls.emailActor ||
        !cls.reminderHours ||
        cls.cancelledAt ||
        cls.completedAt ||
        cls.startsAt <= now ||
        cls.startsAt.getTime() - cls.reminderHours * 3_600_000 > now.getTime() ||
        cls.reminderQueuedFor?.getTime() === cls.startsAt.getTime()
      )
        return 0
      const [attendee] = await tx
        .select({ id: trainingClassAttendees.id })
        .from(trainingClassAttendees)
        .where(
          and(
            eq(trainingClassAttendees.classId, cls.id),
            sql`${trainingClassAttendees.status} in ('registered', 'attended')`,
          ),
        )
        .limit(1)
      if (!attendee) return 0
      const actor = cls.emailActor
      await recordModuleFlowEvent(
        tx,
        {
          tenantId: cls.tenantId,
          userId: actor.userId,
          personId: actor.personId,
          timezone: actor.timezone,
          membership: actor.membershipId ? { id: actor.membershipId } : null,
        },
        {
          moduleKey: 'training-classes',
          subjectId: cls.id,
          event: 'class_reminder',
          occurrenceKey: cls.startsAt.toISOString(),
        },
      )
      await tx
        .update(trainingClasses)
        .set({ reminderQueuedFor: cls.startsAt })
        .where(eq(trainingClasses.id, cls.id))
      await tx.insert(auditLog).values({
        tenantId: cls.tenantId,
        entityType: 'training_class',
        entityId: cls.id,
        action: 'export',
        summary: 'Queued optional class reminder email',
        after: { startsAt: cls.startsAt.toISOString(), reminderHours: cls.reminderHours },
      })
      return 1
    })
  }
  return queued
}
