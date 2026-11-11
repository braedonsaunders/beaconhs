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

/**
 * Grouped row reports bucket rows in SQL result order (`Map` insertion order)
 * and slice at `LIMIT`. Keeping `groupBy` as the primary sort guarantees:
 *  1. Group sections appear in deterministic order instead of first-seen row order.
 *  2. All rows belonging to a group stay contiguous so a `NULLS LAST` secondary
 *     sort (e.g. `expires_on ASC` on missing certificates) can never split a
 *     person's group across a preview row cap.
 * If the caller explicitly sorts by `groupBy` first (`asc` or `desc`), their
 * direction is preserved.
 */
export function normalizeGroupedRowSorts(query: ReportCustomQuery): ReportCustomQuery {
  if ((query.mode ?? 'rows') !== 'rows' || !query.groupBy) return query
  const configured = query.sorts?.length ? query.sorts : query.sort ? [query.sort] : []
  const primary =
    configured[0]?.column === query.groupBy
      ? configured[0]
      : { column: query.groupBy, direction: 'asc' as const }
  const seen = new Set<string>([primary.column])
  const merged = [primary]
  for (const item of configured) {
    if (seen.has(item.column)) continue
    seen.add(item.column)
    merged.push(item)
    if (merged.length >= 3) break
  }
  return {
    ...query,
    sort: null,
    sorts: merged,
  }
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
    normalizeGroupedRowSorts({
      ...query,
      filters: mergeFilters(query.filters ?? null, runtimeFilters),
    }),
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
  const normalizedQuery = normalizeGroupedRowSorts({ ...query, filters })
  const presentation = reportPresentationFromLayout(options.layout)
  validateReportPresentation(presentation, normalizedQuery, catalog)
  const identityProjection = distinctIdentityProjection(normalizedQuery, catalog)
  const { compiled, fields } = reportCountProjection(
    compileCustomReport(identityProjection.query, tenantId, identityProjection.catalog, options),
    normalizedQuery.entity,
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

/** Name projections must not merge separate people/records in distinct counts. */
function distinctIdentityProjection(query: ReportCustomQuery, catalog: ReportEntityCatalog) {
  const entity = catalog.entities.find((source) => source.key === query.entity)
  if (query.mode !== 'summarize' || !entity || !query.measures) return { query, catalog }
  const columns = [...entity.columns]
  const measures = query.measures.map((measure, index) => {
    const column = columns.find((item) => item.key === measure.column)
    if (measure.fn !== 'count_distinct' || !column?.filterExpression || column.hidden)
      return measure
    let key = '__distinct_identity_' + index
    while (columns.some((item) => item.key === key)) key += '_'
    columns.push({ ...column, key, expression: column.filterExpression, hidden: false })
    return { ...measure, column: key }
  })
  return {
    query: { ...query, measures },
    catalog: {
      ...catalog,
      entities: catalog.entities.map((source) =>
        source === entity ? { ...entity, columns } : source,
      ),
    },
  }
}
