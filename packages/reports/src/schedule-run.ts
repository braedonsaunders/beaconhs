import { and, eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  reportDefinitions,
  reportRuns,
  reportSchedules,
  type ReportRunRequestSnapshot,
} from '@beaconhs/db/schema'
import { claimReportRun, type ReportRunStore, type ReportRunTrigger } from '@appkit/reports'

type BeaconRunDefinition = ReportRunRequestSnapshot['definition']
type BeaconRunFilters = ReportRunRequestSnapshot['filters']

function beaconReportRunStore(tx: Database): ReportRunStore<BeaconRunDefinition, BeaconRunFilters> {
  return {
    async loadContext(scheduleId) {
      const [row] = await tx
        .select({ schedule: reportSchedules, definition: reportDefinitions })
        .from(reportSchedules)
        .innerJoin(
          reportDefinitions,
          and(
            eq(reportDefinitions.tenantId, reportSchedules.tenantId),
            eq(reportDefinitions.id, reportSchedules.definitionId),
          ),
        )
        .where(eq(reportSchedules.id, scheduleId))
        .limit(1)
      if (!row) return null
      return {
        tenantId: row.schedule.tenantId,
        scheduleId: row.schedule.id,
        scheduleName: row.schedule.name,
        definition: {
          id: row.definition.id,
          slug: row.definition.slug,
          name: row.definition.name,
          query: row.definition.query,
          layout: row.definition.layout,
          state: row.definition.state,
          tags: row.definition.tags,
        },
        filters: row.schedule.filters,
        recipientUserIds: row.schedule.recipientUserIds,
        recipientEmails: row.schedule.recipientEmails,
        emailSubject: row.schedule.emailSubject,
        emailMessage: row.schedule.emailMessage,
        runAsTenantUserId: row.schedule.runAsTenantUserId,
        runAsRoleId: row.schedule.runAsRoleId,
      }
    },
    async insert(input) {
      const [created] = await tx
        .insert(reportRuns)
        .values({
          tenantId: input.tenantId,
          scheduleId: input.scheduleId,
          scheduledFor: input.scheduledFor,
          trigger: input.trigger,
          requestSnapshot: input.requestSnapshot as ReportRunRequestSnapshot,
          status: input.status,
        })
        .onConflictDoNothing({
          target: [reportRuns.scheduleId, reportRuns.scheduledFor],
        })
        .returning({ id: reportRuns.id })
      return created ?? null
    },
    async find(scheduleId, scheduledFor) {
      const [run] = await tx
        .select({ id: reportRuns.id, trigger: reportRuns.trigger })
        .from(reportRuns)
        .where(
          and(eq(reportRuns.scheduleId, scheduleId), eq(reportRuns.scheduledFor, scheduledFor)),
        )
        .limit(1)
      return run ?? null
    },
  }
}

export function claimBeaconReportRun(
  tx: Database,
  input: {
    scheduleId: string
    scheduledFor: Date
    trigger: ReportRunTrigger
  },
) {
  return claimReportRun(beaconReportRunStore(tx), input)
}
