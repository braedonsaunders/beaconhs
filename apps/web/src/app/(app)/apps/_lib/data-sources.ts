'use server'

// Query + aggregate layer for DATA SOURCES — the server-side resolver behind
// data-bound app elements (lookup, data_table, metric). Every entry point goes
// through `requireRequestContext()` so RLS scopes reads to the caller's tenant;
// the browser only authors bindings, it never reaches the DB directly.
//
// Two source kinds (see packages/db/src/schema/data-sources.ts):
//   - 'reference' → rows live in `data_source_rows` (admin-curated).
//   - 'responses' → rows are DERIVED from submitted form_responses of a chosen
//     template at query time (each response.data map is one row, augmented with
//     __status / __submittedAt / __site meta columns).

import { and, asc, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import {
  dataSourceRows,
  dataSources,
  formResponses,
  type DataSource,
  type DataSourceColumn,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

// Hard safety cap on rows pulled into memory for a single query/aggregate.
const ROW_CAP = 1000

export type DataSourceSummary = {
  id: string
  key: string
  name: string
  kind: 'reference' | 'responses'
  columns: DataSourceColumn[]
}

export type DataRow = Record<string, unknown>

export type DataQueryResult = {
  columns: DataSourceColumn[]
  rows: DataRow[]
}

export type DataAggregateResult = {
  // Single value for an ungrouped aggregate (null when no rows / not computable).
  value: number | null
  // Series for a grouped aggregate (charts / breakdowns), sorted desc by value.
  groups?: { key: string; value: number }[]
  // How many rows were considered (after filters, before the row cap).
  total: number
}

type WhereClause = { column: string; value: unknown }

// ---------------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

// Forgiving equality — jsonb values may be numbers or strings depending on how
// a row was authored, so compare by normalized string.
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  return String(a) === String(b)
}

function groupKey(v: unknown): string {
  if (v == null || v === '') return '—'
  return String(v)
}

// ---------------------------------------------------------------------------

async function resolveSource(sourceKey: string): Promise<DataSource | null> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const [src] = await tx
      .select()
      .from(dataSources)
      .where(and(eq(dataSources.key, sourceKey), isNull(dataSources.deletedAt)))
      .limit(1)
    return src ?? null
  })
}

// Pull the raw rows for a source (reference rows, or response-derived rows).
// Every row carries a stable `__rowId` so lookups can store a durable value.
async function fetchRows(source: DataSource): Promise<DataRow[]> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    if (source.kind === 'responses') {
      const templateId = source.config?.templateId
      if (!templateId) return []
      const resp = await tx
        .select({
          id: formResponses.id,
          data: formResponses.data,
          status: formResponses.status,
          submittedAt: formResponses.submittedAt,
          siteOrgUnitId: formResponses.siteOrgUnitId,
        })
        .from(formResponses)
        // submittedAt is stamped on every completed response (submitted +
        // non_compliant both set it), so this cleanly excludes drafts.
        .where(and(eq(formResponses.templateId, templateId), isNotNull(formResponses.submittedAt)))
        .orderBy(desc(formResponses.submittedAt))
        .limit(ROW_CAP)
      let rows: DataRow[] = resp.map((r) => ({
        __rowId: r.id,
        __status: r.status,
        __submittedAt: r.submittedAt ? r.submittedAt.toISOString() : null,
        __site: r.siteOrgUnitId,
        ...((r.data as Record<string, unknown> | null) ?? {}),
      }))
      const statuses = source.config?.statuses
      if (statuses && statuses.length > 0) {
        rows = rows.filter((r) => statuses.includes(String(r.__status)))
      }
      return rows
    }
    // reference kind
    const rows = await tx
      .select({ id: dataSourceRows.id, data: dataSourceRows.data })
      .from(dataSourceRows)
      .where(and(eq(dataSourceRows.dataSourceId, source.id), isNull(dataSourceRows.deletedAt)))
      .orderBy(asc(dataSourceRows.position))
      .limit(ROW_CAP)
    return rows.map((r) => ({ __rowId: r.id, ...((r.data as Record<string, unknown>) ?? {}) }))
  })
}

function applyFilters(
  rows: DataRow[],
  where: WhereClause[] | undefined,
  filterColumn: string | undefined,
  filterValue: unknown,
): DataRow[] {
  let out = rows
  if (where && where.length > 0) {
    out = out.filter((r) => where.every((w) => looseEq(r[w.column], w.value)))
  }
  if (filterColumn) {
    // A cascade with no parent selection yet yields an empty list (correct: the
    // child can't be chosen until the parent is).
    if (filterValue == null || filterValue === '') return []
    out = out.filter((r) => looseEq(r[filterColumn], filterValue))
  }
  return out
}

// ---------------------------------------------------------------------------

/** List every data source in the tenant (for the designer binding editor). */
export async function listDataSources(): Promise<DataSourceSummary[]> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: dataSources.id,
        key: dataSources.key,
        name: dataSources.name,
        kind: dataSources.kind,
        columns: dataSources.columns,
      })
      .from(dataSources)
      .where(isNull(dataSources.deletedAt))
      .orderBy(asc(dataSources.name))
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      kind: r.kind,
      columns: (r.columns as DataSourceColumn[]) ?? [],
    }))
  })
}

/**
 * Resolve rows for a lookup dropdown or a data_table. Supports a static `where`
 * filter, a cascade filter (`filterColumn` matched against `filterValue` — the
 * parent field's current value), and a row `limit`.
 */
export async function queryDataSource(args: {
  sourceKey: string
  where?: WhereClause[]
  filterColumn?: string
  filterValue?: unknown
  limit?: number
}): Promise<DataQueryResult> {
  const source = await resolveSource(args.sourceKey)
  if (!source) return { columns: [], rows: [] }
  const all = await fetchRows(source)
  let rows = applyFilters(all, args.where, args.filterColumn, args.filterValue)
  if (args.limit && args.limit > 0) rows = rows.slice(0, args.limit)
  return { columns: (source.columns as DataSourceColumn[]) ?? [], rows }
}

/**
 * Aggregate a source into a single KPI value or a grouped series (for charts).
 * `fn` count ignores `column`; sum/avg/min/max read `column`. `groupBy` produces
 * one entry per distinct value of that column.
 */
export async function aggregateDataSource(args: {
  sourceKey: string
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max'
  column?: string
  groupBy?: string
  where?: WhereClause[]
  filterColumn?: string
  filterValue?: unknown
  limit?: number
}): Promise<DataAggregateResult> {
  const source = await resolveSource(args.sourceKey)
  if (!source) return { value: null, total: 0 }
  const all = await fetchRows(source)
  const rows = applyFilters(all, args.where, args.filterColumn, args.filterValue)

  const compute = (group: DataRow[]): number | null => {
    if (args.fn === 'count') return group.length
    const nums = group.map((r) => toNum(r[args.column ?? ''])).filter((n): n is number => n != null)
    if (nums.length === 0) return null
    switch (args.fn) {
      case 'sum':
        return nums.reduce((a, b) => a + b, 0)
      case 'avg':
        return nums.reduce((a, b) => a + b, 0) / nums.length
      case 'min':
        return Math.min(...nums)
      case 'max':
        return Math.max(...nums)
    }
  }

  if (args.groupBy) {
    const buckets = new Map<string, DataRow[]>()
    for (const r of rows) {
      const k = groupKey(r[args.groupBy])
      const arr = buckets.get(k)
      if (arr) arr.push(r)
      else buckets.set(k, [r])
    }
    let groups = [...buckets.entries()].map(([key, group]) => ({
      key,
      value: compute(group) ?? 0,
    }))
    groups.sort((a, b) => b.value - a.value)
    if (args.limit && args.limit > 0) groups = groups.slice(0, args.limit)
    return { value: null, groups, total: rows.length }
  }

  return { value: compute(rows), total: rows.length }
}
