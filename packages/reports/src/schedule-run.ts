import { and, eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  reportDefinitions,
  reportRuns,
  reportSchedules,
  type ReportRunRequestSnapshot,
} from '@beaconhs/db/schema'

export type ClaimedReportRun = {
  id: string
  scheduledFor: Date
  created: boolean
}

function snapshotRequest(
  schedule: typeof reportSchedules.$inferSelect,
  definition: typeof reportDefinitions.$inferSelect,
): ReportRunRequestSnapshot {
  return {
    scheduleName: schedule.name,
    definition: {
      id: definition.id,
      slug: definition.slug,
      name: definition.name,
      queryKind: definition.queryKind,
      customQuery: definition.customQuery ?? null,
      layout: definition.layout ?? null,
    },
    filters: { ...schedule.filters },
    recipientUserIds: [...schedule.recipientUserIds],
    recipientEmails: [...schedule.recipientEmails],
    emailSubject: schedule.emailSubject,
    emailMessage: schedule.emailMessage,
    runAsTenantUserId: schedule.runAsTenantUserId,
    runAsRoleId: schedule.runAsRoleId,
  }
}

/**
 * Create the durable execution record before a BullMQ job is published.
 *
 * Scheduled occurrences are idempotent at (scheduleId, scheduledFor). Manual
 * requests are always distinct; in the extremely small same-millisecond case,
 * the timestamp is advanced until it identifies a new occurrence.
 */
export async function claimReportRun(
  tx: Database,
  input: {
    scheduleId: string
    scheduledFor: Date
    trigger: 'scheduled' | 'manual'
  },
): Promise<ClaimedReportRun> {
  const [context] = await tx
    .select({ schedule: reportSchedules, definition: reportDefinitions })
    .from(reportSchedules)
    .innerJoin(reportDefinitions, eq(reportDefinitions.id, reportSchedules.definitionId))
    .where(eq(reportSchedules.id, input.scheduleId))
    .limit(1)
  if (!context) throw new Error(`Report schedule ${input.scheduleId} was not found`)

  const requestSnapshot = snapshotRequest(context.schedule, context.definition)
  let scheduledFor = input.scheduledFor

  for (;;) {
    const [inserted] = await tx
      .insert(reportRuns)
      .values({
        tenantId: context.schedule.tenantId,
        scheduleId: context.schedule.id,
        scheduledFor,
        trigger: input.trigger,
        requestSnapshot,
        status: 'queued',
      })
      .onConflictDoNothing({
        target: [reportRuns.scheduleId, reportRuns.scheduledFor],
      })
      .returning({ id: reportRuns.id })
    if (inserted) return { id: inserted.id, scheduledFor, created: true }

    const [existing] = await tx
      .select({ id: reportRuns.id, trigger: reportRuns.trigger })
      .from(reportRuns)
      .where(
        and(
          eq(reportRuns.scheduleId, context.schedule.id),
          eq(reportRuns.scheduledFor, scheduledFor),
        ),
      )
      .limit(1)
    if (!existing) {
      throw new Error('Report run conflict was not visible after insertion')
    }
    if (input.trigger === 'scheduled' && existing.trigger === 'scheduled') {
      return { id: existing.id, scheduledFor, created: false }
    }
    scheduledFor = new Date(scheduledFor.getTime() + 1)
  }
}
