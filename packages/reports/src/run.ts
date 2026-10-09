import { reportCountProjection, extractReportCounts } from './presentation-counts'
import { eq } from 'drizzle-orm'
import { tenants } from '@beaconhs/db/schema'
import {
  presentReportResult,
  reportPresentationFromLayout,
  validateReportPresentation,
} from './presentation'
import { executeParameterizedRows, type Database } from '@beaconhs/db'
import { withDomainCellTones } from './cell-tones'
import {
  compileCustomReport,
  customReportResult,
  type ReportCustomQuery,
  type ReportEntityCatalog,
  type ReportRuleGroup,
  type ReportRunResult,
} from '@braedonsaunders/appkit-reports'

export type BeaconReportRunOptions = {
  maxRows?: number
  layout?: unknown
  fiscalStartMonth?: number
  runtimeFilters?: ReportRuleGroup | null
}

export function normalizeReportRuntimeFilters(
  value: Record<string, unknown>,
): ReportRuleGroup | null {
  if (Object.keys(value).length === 0) return null
  if ((value.combinator === 'and' || value.combinator === 'or') && Array.isArray(value.rules)) {
    return value as ReportRuleGroup
  }
  throw new Error('Report filters are not a valid AppKit filter group')
}

export function validateBeaconReportRuntimeFilters(
  tenantId: string,
  query: ReportCustomQuery,
  catalog: ReportEntityCatalog,
  runtimeFilters: ReportRuleGroup | null,
): void {
  compileCustomReport(
    { ...query, filters: mergeFilters(query.filters ?? null, runtimeFilters) },
    tenantId,
    catalog,
    { maxRows: 1 },
  )
}

/**
 * Execute one AppKit definition inside an already tenant-scoped BeaconHS
 * transaction. AppKit authors and validates the SQL plan; BeaconHS supplies
 * only its RLS transaction, tenant id, and domain catalogue.
 */
export async function runBeaconReport(
  tx: Database,
  tenantId: string,
  query: ReportCustomQuery,
  catalog: ReportEntityCatalog,
  options: BeaconReportRunOptions = {},
): Promise<ReportRunResult> {
  const filters = mergeFilters(query.filters ?? null, options.runtimeFilters ?? null)
  const presentation = reportPresentationFromLayout(options.layout)
  validateReportPresentation(presentation, query, catalog)
  const { compiled, fields } = reportCountProjection(
    compileCustomReport({ ...query, filters }, tenantId, catalog, options),
    query.entity,
    catalog,
    presentation,
  )
  const startedAt = performance.now()
  const rows = await executeParameterizedRows(tx, compiled.sql, compiled.params)
  let result = customReportResult(compiled, [...rows], performance.now() - startedAt)
  if (presentation) {
    const extracted = extractReportCounts(result, fields)
    result = extracted.result
    const [tenant] = await tx
      .select({ name: tenants.name, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1)
    if (!tenant) throw new Error('Report tenant not found.')
    const settings = tenant.settings ?? {}
    result = presentReportResult(
      result,
      presentation,
      {
        name: tenant.name,
        companyName: typeof settings.companyName === 'string' ? settings.companyName : tenant.name,
        companyAddress: typeof settings.companyAddress === 'string' ? settings.companyAddress : '',
      },
      new Date(),
      extracted.counts,
    )
  }
  return withDomainCellTones(result)
}

function mergeFilters(
  definition: ReportRuleGroup | null,
  runtime: ReportRuleGroup | null,
): ReportRuleGroup | null {
  if (!definition) return runtime
  if (!runtime) return definition
  return { combinator: 'and', rules: [definition, runtime] }
}
