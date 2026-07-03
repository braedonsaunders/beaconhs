// Executor for user-built custom reports. JOIN-free and SQL-injection-safe:
// table + column identifiers come exclusively from a resolved entity whitelist
// and all values bind as parameters.
//
// Two modes:
//   rows      — detail rows (optionally bucketed into sections by groupBy).
//   summarize — GROUP BY breakouts + aggregate measures (count/sum/avg/…), with
//               optional temporal bucketing on a date/timestamp breakout.
// Both emit the same ReportRunResult shape (groups + summary + charts), so the
// viewer, PDF, CSV and XLSX consumers are identical.
//
// The entity whitelist is INJECTED by the caller (opts.entityMap — the discovered
// catalog from @beaconhs/analytics/server) so every tenant-scoped table is
// queryable, falling back to the static REPORT_ENTITY_MAP for legacy keys. This
// package never depends on @beaconhs/analytics (the graph stays acyclic).
//
// Runs against a caller-provided transaction that is ALREADY tenant-scoped —
// the web app passes ctx.db's tx (RLS via app.tenant_id), the worker passes a
// withTenant tx. This module never widens scope itself.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  REPORT_AGG_FNS,
  REPORT_TEMPORAL_BINS,
  type ReportAggFn,
  type ReportBreakout,
  type ReportChartConfig,
  type ReportCustomQuery,
  type ReportMeasure,
  type ReportTemporalBin,
} from '@beaconhs/db/schema'
import { REPORT_ENTITY_MAP, columnRef, entityColumnSql, type ReportEntity } from './entities'
import { compileCustomFilters } from './filters'
import { formatLabel, type ReportChartSpec, type ReportGroup, type ReportRunResult } from './types'

const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 10_000
/** Max distinct dimension values plotted; the long tail folds into "(other)". */
const CHART_CATEGORY_CAP = 20

export type RunCustomQueryOpts = {
  maxRows?: number
  /** Resolved entity whitelist (discovered catalog). Falls back to the static
   *  REPORT_ENTITY_MAP per key so legacy saved reports keep resolving. */
  entityMap?: Record<string, ReportEntity>
}

/** AND the entity's implicit soft-delete predicate into a compiled WHERE so
 *  soft-deleted rows never surface in custom reports — the same convention the
 *  module list pages and the report_* views follow. */
function withSoftDeleteFilter(entity: ReportEntity, where: SQL | null): SQL | null {
  if (!entity.softDelete) return where
  const notDeleted = sql.raw(`"${entity.table}"."deleted_at" IS NULL`)
  if (!where) return notDeleted
  return sql.join([notDeleted, sql.raw(' AND ('), where, sql.raw(')')], sql.raw(''))
}

export async function runCustomQuery(
  tx: Database,
  customQuery: unknown,
  opts: RunCustomQueryOpts = {},
): Promise<ReportRunResult> {
  const q = (customQuery ?? null) as ReportCustomQuery | null
  const entity = q?.entity ? (opts.entityMap?.[q.entity] ?? REPORT_ENTITY_MAP[q.entity]) : null
  if (!q || !entity) {
    throw new Error('Custom query missing or has unknown entity')
  }
  if (q.mode === 'summarize') return runAggregateQuery(tx, entity, q, opts)
  return runRowQuery(tx, entity, q, opts)
}

// --- rows mode ---------------------------------------------------------------

async function runRowQuery(
  tx: Database,
  entity: ReportEntity,
  q: ReportCustomQuery,
  opts: RunCustomQueryOpts,
): Promise<ReportRunResult> {
  const requestedColumns = (q.columns ?? []).filter((c) => entityColumnSql(entity, c))
  if (requestedColumns.length === 0) {
    throw new Error('Custom query requires at least one valid column')
  }

  const where = withSoftDeleteFilter(entity, compileCustomFilters(entity, q))
  const sortCol = q.sort?.column ? entityColumnSql(entity, q.sort.column) : null
  const sortDir = q.sort?.direction === 'asc' ? 'ASC' : 'DESC'
  const limit = resolveLimit(q.limit, opts.maxRows)

  const selectList = sql.raw(
    requestedColumns.map((c) => `${columnRef(entity, c)} AS "${c}"`).join(', '),
  )
  const whereSql = where ? sql.join([sql.raw('WHERE'), where], sql.raw(' ')) : sql.raw('')
  const orderSql =
    q.sort?.column && sortCol
      ? sql.raw(`ORDER BY ${columnRef(entity, q.sort.column)} ${sortDir}`)
      : sql.raw('')

  const queryText = sql.join(
    [
      sql.raw('SELECT'),
      selectList,
      sql.raw(`FROM "${entity.table}"`),
      whereSql,
      orderSql,
      sql.raw(`LIMIT ${limit}`),
    ],
    sql.raw(' '),
  )

  const result = (await tx.execute(queryText)) as unknown
  const dataRows = extractRows(result)

  const groups: ReportGroup[] = []
  const groupByValid = q.groupBy && entityColumnSql(entity, q.groupBy) ? q.groupBy : null
  const columnLabels = requestedColumns.map((c) => labelFor(entity, c))

  if (groupByValid) {
    const byKey = new Map<string, Record<string, unknown>[]>()
    for (const row of dataRows) {
      const k = String(row[groupByValid] ?? '(none)')
      const list = byKey.get(k) ?? []
      list.push(row)
      byKey.set(k, list)
    }
    if (byKey.size === 0) {
      groups.push({ title: 'Results', columns: columnLabels, rows: [], isEmpty: true })
    } else {
      for (const [k, list] of [...byKey.entries()].sort()) {
        groups.push({
          title: `${labelFor(entity, groupByValid)}: ${formatLabel(k)}`,
          subtitle: `${list.length} row(s)`,
          columns: columnLabels,
          rows: list.map((row) => requestedColumns.map((c) => formatCustomValue(row[c]))),
        })
      }
    }
  } else {
    groups.push({
      title: 'Results',
      subtitle: `${dataRows.length} row(s)`,
      columns: columnLabels,
      rows: dataRows.map((row) => requestedColumns.map((c) => formatCustomValue(row[c]))),
      isEmpty: dataRows.length === 0,
    })
  }

  const charts: ReportChartSpec[] = []
  if (q.chart?.dimension && entityColumnSql(entity, q.chart.dimension)) {
    const chart = await runChartAggregate(tx, entity, q.chart, where)
    if (chart) charts.push(chart)
  }

  return {
    groups,
    summary: [
      { label: 'Rows', value: dataRows.length },
      { label: 'Entity', value: entity.label },
    ],
    charts,
    rowCount: dataRows.length,
  }
}

// --- summarize mode ----------------------------------------------------------

const AGG_FN_LABEL: Record<ReportAggFn, string> = {
  count: 'Count',
  count_distinct: 'Distinct count',
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
}

async function runAggregateQuery(
  tx: Database,
  entity: ReportEntity,
  q: ReportCustomQuery,
  opts: RunCustomQueryOpts,
): Promise<ReportRunResult> {
  // Resolve breakouts (group-by dimensions) and measures from the whitelist.
  const breakouts = (q.breakouts ?? []).filter((b) => entityColumnSql(entity, b.column))
  let measures = (q.measures ?? []).filter(
    (m) => m.fn === 'count' || (m.column && entityColumnSql(entity, m.column)),
  )
  measures = measures.filter((m) => REPORT_AGG_FNS.includes(m.fn))
  if (measures.length === 0) measures = [{ fn: 'count' }]

  const dimSelect = breakouts.map((b, i) => `${dimExpr(entity, b)} AS "d${i}"`)
  const measSelect = measures.map((m, i) => `${measureExpr(entity, m)} AS "m${i}"`)

  const where = withSoftDeleteFilter(entity, compileCustomFilters(entity, q))
  const whereSql = where ? sql.join([sql.raw('WHERE'), where], sql.raw(' ')) : sql.raw('')

  const groupBySql =
    breakouts.length > 0
      ? sql.raw(`GROUP BY ${breakouts.map((_, i) => i + 1).join(', ')}`)
      : sql.raw('')

  // Order: a temporal trend reads best chronologically; otherwise rank by the
  // first measure (top-N). The first measure's ordinal is dims + 1.
  const firstMeasureOrdinal = breakouts.length + 1
  const orderSql =
    breakouts.length === 0
      ? sql.raw('')
      : breakouts[0]?.bin
        ? sql.raw('ORDER BY 1 ASC')
        : sql.raw(`ORDER BY ${firstMeasureOrdinal} DESC NULLS LAST`)

  const limit = resolveLimit(q.limit, opts.maxRows)

  const queryText = sql.join(
    [
      sql.raw(`SELECT ${[...dimSelect, ...measSelect].join(', ')}`),
      sql.raw(`FROM "${entity.table}"`),
      whereSql,
      groupBySql,
      orderSql,
      sql.raw(`LIMIT ${limit}`),
    ],
    sql.raw(' '),
  )

  const result = (await tx.execute(queryText)) as unknown
  const dataRows = extractRows(result)

  const columns = [
    ...breakouts.map((b) => breakoutLabel(entity, b)),
    ...measures.map((m) => measureLabel(entity, m)),
  ]
  const rows = dataRows.map((row) => [
    ...breakouts.map((b, i) => formatBreakoutValue(row[`d${i}`], b.bin)),
    ...measures.map((_, i) => formatCustomValue(row[`m${i}`])),
  ])

  const groups: ReportGroup[] = [
    {
      title: 'Summary',
      subtitle:
        breakouts.length > 0
          ? `${dataRows.length} group${dataRows.length === 1 ? '' : 's'}`
          : undefined,
      columns,
      rows,
      isEmpty: dataRows.length === 0,
    },
  ]

  // Grand totals for count/sum measures make useful summary cards.
  const summary: ReportRunResult['summary'] = [
    { label: breakouts.length > 0 ? 'Groups' : 'Rows', value: dataRows.length },
  ]
  measures.forEach((m, i) => {
    if (m.fn === 'count' || m.fn === 'count_distinct' || m.fn === 'sum') {
      const total = dataRows.reduce((acc, r) => acc + (Number(r[`m${i}`]) || 0), 0)
      summary.push({ label: `Total ${measureLabel(entity, m).toLowerCase()}`, value: total })
    }
  })

  const charts: ReportChartSpec[] = []
  if (q.chart?.type && breakouts.length > 0) {
    const chart = buildSummarizeChart(entity, q.chart, breakouts, measures, dataRows)
    if (chart) charts.push(chart)
  }

  return { groups, summary, charts, rowCount: dataRows.length }
}

/** SQL for a group-by dimension, with optional temporal bucketing. The bin is
 *  re-validated against the whitelist before interpolation (defence in depth). */
function dimExpr(entity: ReportEntity, b: ReportBreakout): string {
  const ref = columnRef(entity, b.column)!
  const bin = b.bin && REPORT_TEMPORAL_BINS.includes(b.bin) ? b.bin : null
  return bin ? `date_trunc('${bin}', ${ref})` : ref
}

/** SQL for an aggregate measure. Identifiers come from the whitelist only. */
function measureExpr(entity: ReportEntity, m: ReportMeasure): string {
  if (m.fn === 'count') return 'COUNT(*)::int'
  const ref = columnRef(entity, m.column ?? '')!
  switch (m.fn) {
    case 'count_distinct':
      return `COUNT(DISTINCT ${ref})::int`
    case 'sum':
      return `SUM(${ref})`
    case 'avg':
      return `ROUND(AVG(${ref})::numeric, 2)`
    case 'min':
      return `MIN(${ref})`
    case 'max':
      return `MAX(${ref})`
    default:
      return 'COUNT(*)::int'
  }
}

function breakoutLabel(entity: ReportEntity, b: ReportBreakout): string {
  const base = labelFor(entity, b.column)
  return b.bin ? `${base} (by ${b.bin})` : base
}

function measureLabel(entity: ReportEntity, m: ReportMeasure): string {
  if (m.label) return m.label
  if (m.fn === 'count') return 'Count'
  return `${AGG_FN_LABEL[m.fn]} of ${labelFor(entity, m.column ?? '')}`
}

/** Format a temporal-bucketed dimension value for display. */
function formatBreakoutValue(v: unknown, bin?: ReportTemporalBin): string | number | null {
  if (!bin) return formatCustomValue(v)
  if (v === null || typeof v === 'undefined') return null
  const iso = v instanceof Date ? v.toISOString() : String(v)
  switch (bin) {
    case 'year':
      return iso.slice(0, 4)
    case 'quarter': {
      const d = v instanceof Date ? v : new Date(iso)
      if (Number.isNaN(d.getTime())) return iso.slice(0, 7)
      return `${d.getUTCFullYear()} Q${Math.floor(d.getUTCMonth() / 3) + 1}`
    }
    case 'month':
      return iso.slice(0, 7)
    default:
      return iso.slice(0, 10) // day, week
  }
}

function buildSummarizeChart(
  entity: ReportEntity,
  chart: ReportChartConfig,
  breakouts: ReportBreakout[],
  measures: ReportMeasure[],
  dataRows: Record<string, unknown>[],
): ReportChartSpec | null {
  if (!dataRows.length) return null
  const dimIdx = Math.max(
    0,
    breakouts.findIndex((b) => b.column === chart.dimension),
  )
  const b = breakouts[dimIdx]!
  const sliced = dataRows.slice(0, CHART_CATEGORY_CAP)
  const xLabels = sliced.map((r) => String(formatBreakoutValue(r[`d${dimIdx}`], b.bin) ?? '(none)'))
  const data = sliced.map((r) => Number(r['m0']) || 0)
  return {
    id: 'summarize',
    title: `${measureLabel(entity, measures[0]!)} by ${breakoutLabel(entity, b)}`,
    type: chart.type,
    xLabels,
    series: [{ name: measureLabel(entity, measures[0]!), data }],
  }
}

// --- shared helpers ----------------------------------------------------------

function resolveLimit(requested: number | null | undefined, maxRows?: number): number {
  const n = Number(requested ?? DEFAULT_LIMIT)
  let limit = Math.min(Math.max(Number.isFinite(n) ? n : DEFAULT_LIMIT, 1), MAX_LIMIT)
  if (maxRows) limit = Math.min(limit, maxRows)
  return limit
}

/** COUNT(*) per distinct dimension value, under the same WHERE as the main
 *  query, so the chart always agrees with the table (rows mode). */
async function runChartAggregate(
  tx: Database,
  entity: ReportEntity,
  chart: ReportChartConfig,
  where: SQL | null,
): Promise<ReportChartSpec | null> {
  const dimSql = sql.raw(columnRef(entity, chart.dimension)!)
  const kind = entity.columns.find((c) => c.key === chart.dimension)?.kind
  // Bucket timestamps/dates by day so a time dimension charts sensibly.
  const keyExpr =
    kind === 'timestamp' || kind === 'date'
      ? sql.join([sql.raw('to_char('), dimSql, sql.raw(`, 'YYYY-MM-DD')`)], sql.raw(''))
      : dimSql

  const queryText = sql.join(
    [
      sql.raw('SELECT '),
      keyExpr,
      sql.raw(` AS "k", COUNT(*)::int AS "c" FROM "${entity.table}" `),
      where ? sql.join([sql.raw('WHERE '), where], sql.raw('')) : sql.raw(''),
      sql.raw(' GROUP BY 1 ORDER BY '),
      kind === 'timestamp' || kind === 'date' ? sql.raw('1 ASC') : sql.raw('2 DESC'),
      sql.raw(` LIMIT ${CHART_CATEGORY_CAP}`),
    ],
    sql.raw(''),
  )

  const result = (await tx.execute(queryText)) as unknown
  const rows = extractRows(result) as { k: unknown; c: number }[]
  if (!rows.length) return null

  const xLabels = rows.map((r) => formatLabel(String(r.k ?? '(none)')))
  const data = rows.map((r) => Number(r.c))

  return {
    id: 'custom',
    title: `${labelFor(entity, chart.dimension)} — row count`,
    type: chart.type,
    xLabels,
    series: [{ name: 'Rows', data }],
  }
}

function labelFor(entity: ReportEntity, key: string): string {
  return entity.columns.find((c) => c.key === key)?.label ?? formatLabel(key)
}

function formatCustomValue(v: unknown): string | number | null {
  if (v === null || typeof v === 'undefined') return null
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ')
  if (typeof v === 'object') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'string') return v
  return String(v)
}

/** Normalise a drizzle/postgres-js execute() result into a row array. */
export function extractRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[]
  if (result && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: Record<string, unknown>[] }).rows
  }
  return []
}
