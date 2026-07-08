// Source catalog for the report studio. Builder apps appear as their own
// titled sources (scoped `form_responses:<templateId>` entities from
// @beaconhs/analytics) and the raw form_* plumbing tables are hidden — a
// report author picks "Lift Plan", never "form_responses".

import { discoverEntitiesWithApps } from '@beaconhs/analytics/server'
import type { ReportEntity } from '@beaconhs/reports'
import type { RequestContext } from '@beaconhs/tenant'

export async function loadReportStudioEntities(ctx: RequestContext): Promise<ReportEntity[]> {
  const all = await ctx.db((tx) => discoverEntitiesWithApps(tx))
  return all.filter((e) => e.key.includes(':') || !e.table.startsWith('form_'))
}
