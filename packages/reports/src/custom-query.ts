// Executor for user-built custom reports. JOIN-free and SQL-injection-safe:
// table + column identifiers come exclusively from the entity whitelist in
// ./entities.ts and all values bind as parameters.
//
// Runs against a caller-provided transaction that is ALREADY tenant-scoped —
// the web app passes ctx.db's tx (RLS via app.tenant_id), the worker passes a
// withTenant tx. This module never widens scope itself.

import { sql, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import type { ReportChartConfig, ReportCustomQuery } from '@beaconhs/db/schema'
import { REPORT_ENTITY_MAP, entityColumnSql, type ReportEntity } from './entities'
import { compileCustomFilters } from './filters'
import { formatLabel, type ReportChartSpec, type ReportGroup, type ReportRunResult } from './types'

const DEFAULT_LIMIT = 1000
const MAX_LIMIT = 10_000
/** Max distinct dimension values plotted; the long tail folds into "(other)". */
const CHART_CATEGORY_CAP = 20

export async function runCustomQuery(
  tx: Database,
  customQuery: unknown,
  opts: { maxRows?: number } = {},
): Promise<ReportRunResult> {
  const q = (customQuery ?? null) as ReportCustomQuery | null
  const entity = q?.entity ? REPORT_ENTITY_MAP[q.entity] : null
  if (!q || !entity) {
    throw new Error('Custom query missing or has unknown entity')
  }
  const requestedColumns = (q.columns ?? []).filter((c) => entityColumnSql(entity, c))
  if (requestedColumns.length === 0) {
    throw new Error('Custom query requires at least one valid column')
  }

  const where = compileCustomFilters(entity, q)
  const sortCol = q.sort?.column ? entityColumnSql(entity, q.sort.column) : null
  const sortDir = q.sort?.direction === 'asc' ? 'ASC' : 'DESC'
  const requested = Number(q.limit ?? DEFAULT_LIMIT)
  let limit = Math.min(
    Math.max(Number.isFinite(requested) ? requested : DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  )
  if (opts.maxRows) limit = Math.min(limit, opts.maxRows)

  const selectList = sql.raw(
    requestedColumns
      .map((c) => `"${entity.table}"."${entityColumnSql(entity, c)}" AS "${c}"`)
      .join(', '),
  )
  const whereSql = where ? sql.join([sql.raw('WHERE'), where], sql.raw(' ')) : sql.raw('')
  const orderSql = sortCol
    ? sql.raw(`ORDER BY "${entity.table}"."${sortCol}" ${sortDir}`)
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
    const chart = await runChartAggregate(tx, entity, q, q.chart, where)
    if (chart) charts.push(chart)
  }

  return {
    groups,
    summary: [
      { label: 'Rows', value: dataRows.length },
      { label: 'Entity', value: formatLabel(String(q.entity)) },
    ],
    charts,
    rowCount: dataRows.length,
  }
}

/** COUNT(*) per distinct dimension value, under the same WHERE as the main
 *  query, so the chart always agrees with the table. */
async function runChartAggregate(
  tx: Database,
  entity: ReportEntity,
  q: ReportCustomQuery,
  chart: ReportChartConfig,
  where: SQL | null,
): Promise<ReportChartSpec | null> {
  const dim = entityColumnSql(entity, chart.dimension)!
  const dimSql = sql.raw(`"${entity.table}"."${dim}"`)
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
