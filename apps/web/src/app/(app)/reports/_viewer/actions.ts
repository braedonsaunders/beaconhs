'use server'

import { assertCan } from '@beaconhs/tenant'
import {
  assertBoundedReportFilters,
  reportColumn,
  reportEntity,
  type ReportRuleGroup,
  type ReportRunResult,
} from '@beaconhs/reports'
import { loadBeaconReportCatalog, runBeaconReport } from '@beaconhs/reports/server'
import { requireRequestContext } from '@/lib/auth'
import { loadDefinitionById } from '../_definitions'

export async function runReportWithControls(
  definitionId: string,
  controls: { filters: ReportRuleGroup | null; groupBy: string | null },
): Promise<{ ok: true; result: ReportRunResult } | { ok: false; error: string }> {
  try {
    const ctx = await requireRequestContext()
    assertCan(ctx, 'reports.read')
    if (controls.filters) assertBoundedReportFilters(controls.filters)
    const definition = await loadDefinitionById(ctx.tenantId!, definitionId)
    if (!definition) throw new Error('Report not found.')
    const result = await ctx.db(async (tx) => {
      const catalog = await loadBeaconReportCatalog(tx)
      const entity = reportEntity(catalog, definition.query.entity)
      if (!entity) throw new Error('The report data source is no longer available.')
      if (controls.groupBy && !reportColumn(entity, controls.groupBy)) {
        throw new Error('Choose an available group field.')
      }
      return runBeaconReport(
        tx,
        ctx.tenantId!,
        {
          ...definition.query,
          filters: controls.filters,
          groupBy: controls.groupBy,
        },
        catalog,
        { maxRows: 500 },
      )
    })
    return { ok: true, result }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}
