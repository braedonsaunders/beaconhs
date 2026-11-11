'use server'

import { assertCan } from '@beaconhs/tenant'
import {
  assertBoundedReportFilters,
  reportColumn,
  reportEntity,
  type ReportRuleGroup,
  type ReportRunResult,
} from '@beaconhs/reports'
import { runBeaconReport } from '@beaconhs/reports/server'
import { requireRequestContext } from '@/lib/auth'
import { loadAuthorizedReportCatalogInTransaction } from '@/lib/report-catalog'
import { loadDefinitionById } from '../_definitions'
import { applyRuntimeSortOverride, DOCUMENT_PREVIEW_MAX_ROWS } from '../_run'

export async function runReportWithControls(
  definitionId: string,
  controls: {
    filters: ReportRuleGroup | null
    groupBy: string | null
    sort?: { column: string; direction: 'asc' | 'desc' } | null
  },
): Promise<{ ok: true; result: ReportRunResult } | { ok: false; error: string }> {
  try {
    const ctx = await requireRequestContext()
    assertCan(ctx, 'reports.read')
    if (controls.filters) assertBoundedReportFilters(controls.filters)
    const definition = await loadDefinitionById(ctx.tenantId!, definitionId)
    if (!definition) throw new Error('Report not found.')
    const runtimeSort =
      controls.sort && controls.sort.column
        ? {
            column: controls.sort.column,
            direction: controls.sort.direction === 'desc' ? ('desc' as const) : ('asc' as const),
          }
        : null
    const result = await ctx.db(async (tx) => {
      const catalog = await loadAuthorizedReportCatalogInTransaction(ctx, tx)
      const entity = reportEntity(catalog, definition.query.entity)
      if (!entity) throw new Error('The report data source is no longer available.')
      if (controls.groupBy && !reportColumn(entity, controls.groupBy)) {
        throw new Error('Choose an available group field.')
      }
      if (runtimeSort && !reportColumn(entity, runtimeSort.column)) {
        throw new Error('Choose an available sort field.')
      }
      const queryWithControls = applyRuntimeSortOverride(
        {
          ...definition.query,
          filters: controls.filters,
          groupBy: controls.groupBy,
        },
        runtimeSort,
      )
      return runBeaconReport(tx, ctx.tenantId!, queryWithControls, catalog, {
        maxRows: DOCUMENT_PREVIEW_MAX_ROWS,
        layout: definition.layout,
      })
    })
    return { ok: true, result }
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }
}
