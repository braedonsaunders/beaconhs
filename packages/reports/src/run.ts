import { executeParameterizedRows, type Database } from '@beaconhs/db'
import {
  compileCustomReport,
  customReportResult,
  type ReportCustomQuery,
  type ReportEntityCatalog,
  type ReportRuleGroup,
  type ReportRunResult,
} from '@appkit/reports'

export type BeaconReportRunOptions = {
  maxRows?: number
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
  const compiled = compileCustomReport({ ...query, filters }, tenantId, catalog, options)
  const startedAt = performance.now()
  const rows = await executeParameterizedRows(tx, compiled.sql, compiled.params)
  return customReportResult(compiled, [...rows], performance.now() - startedAt)
}

function mergeFilters(
  definition: ReportRuleGroup | null,
  runtime: ReportRuleGroup | null,
): ReportRuleGroup | null {
  if (!definition) return runtime
  if (!runtime) return definition
  return { combinator: 'and', rules: [definition, runtime] }
}
