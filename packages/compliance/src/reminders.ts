import cronParser from 'cron-parser'
import { and, eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { tenantNotificationPolicy, tenantNotificationSettings } from '@beaconhs/db/schema'

/** Missing overrides retain the default-on delivery policy. Evaluation never uses this switch. */
export async function resolveComplianceReminderPolicy(tx: Database, tenantId: string) {
  const [policy] = await tx
    .select({
      enabled: tenantNotificationPolicy.remindersEnabled,
      cron: tenantNotificationPolicy.reminderCron,
      timezone: tenantNotificationPolicy.scanTimezone,
    })
    .from(tenantNotificationPolicy)
    .where(eq(tenantNotificationPolicy.tenantId, tenantId))
    .limit(1)
  const [category] = await tx
    .select({ enabled: tenantNotificationSettings.enabled })
    .from(tenantNotificationSettings)
    .where(
      and(
        eq(tenantNotificationSettings.tenantId, tenantId),
        eq(tenantNotificationSettings.category, 'compliance'),
      ),
    )
    .limit(1)
  return {
    enabled: policy?.enabled !== false && category?.enabled !== false,
    cron: policy?.cron ?? '0 6 * * *',
    timezone: policy?.timezone ?? 'UTC',
  }
}

/** First delivery slot at or after this evaluation, including the current scheduled minute. */
export function complianceReminderAvailableAt(cron: string, timezone: string, now: Date): Date {
  if (cron.trim().split(/\s+/).length !== 5)
    throw new Error('Reminder schedule must have five fields')
  const minute = Math.floor(now.getTime() / 60_000) * 60_000
  const next = cronParser
    .parseExpression(cron, {
      currentDate: new Date(minute - 1),
      tz: timezone,
    })
    .next()
    .toDate()
  return new Date(Math.max(next.getTime(), now.getTime()))
}
