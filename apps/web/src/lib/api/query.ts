// Read one exposed entity as clean JSON rows. Safety comes entirely from the
// reports registry: table + column identifiers are resolved through the entity
// whitelist (never interpolated from input) and filter values bind as
// parameters via @beaconhs/reports' compileFlatFilters. The caller's ctx.db is
// already RLS-bound to the key's tenant.

import { sql } from 'drizzle-orm'
import type { RequestContext } from '@beaconhs/tenant'
import type { ReportCustomFilter, ReportFilterOperator } from '@beaconhs/db/schema'
import {
  compileFlatFilters,
  entityColumnSql,
  extractRows,
  type ReportColumnKind,
  type ReportEntity,
} from '@beaconhs/reports'
import { ApiError } from './errors'
import { recordIdColumn } from './records'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 1000

const CONTROL_PARAMS = new Set(['limit', 'offset', 'sort', 'order', 'fields'])

/** Query-param suffix → filter operator. A bare `?col=v` means equality. */
const SUFFIX_OPS: Record<string, ReportFilterOperator> = {
  neq: 'neq',
  gte: 'gte',
  lte: 'lte',
  in: 'in',
  not_in: 'not_in',
  contains: 'contains',
  is_null: 'is_null',
  is_not_null: 'is_not_null',
}

export type EntityPage = {
  data: Record<string, unknown>[]
  pagination: { limit: number; offset: number; total: number; hasMore: boolean }
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.trunc(n), min), max)
}

/** Split a `column__op` param name into its column and operator. */
function parseFilterParam(name: string): { column: string; op: ReportFilterOperator } | null {
  const sep = name.lastIndexOf('__')
  if (sep === -1) return { column: name, op: 'eq' }
  const op = SUFFIX_OPS[name.slice(sep + 2)]
  if (!op) return null
  return { column: name.slice(0, sep), op }
}

/** Build the validated filter list from query params, skipping anything that
 *  doesn't resolve to a whitelisted column or a known operator. */
function buildFilters(entity: ReportEntity, params: URLSearchParams): ReportCustomFilter[] {
  const filters: ReportCustomFilter[] = []
  for (const [name, value] of params.entries()) {
    if (CONTROL_PARAMS.has(name)) continue
    const parsed = parseFilterParam(name)
    if (!parsed) throw ApiError.invalid(`Unknown filter operator on "${name}"`)
    if (!entityColumnSql(entity, parsed.column)) {
      throw ApiError.invalid(`Unknown filter column "${parsed.column}" for entity "${entity.key}"`)
    }
    if (parsed.op === 'in' || parsed.op === 'not_in') {
      const list = value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (list.length) filters.push({ column: parsed.column, op: parsed.op, value: list })
    } else if (parsed.op === 'is_null' || parsed.op === 'is_not_null') {
      filters.push({ column: parsed.column, op: parsed.op })
    } else {
      filters.push({ column: parsed.column, op: parsed.op, value })
    }
  }
  return filters
}

/** Resolve which whitelisted columns to return (default: all). */
function resolveFields(entity: ReportEntity, params: URLSearchParams): string[] {
  const requested = params.get('fields')
  const all = entity.columns.map((c) => c.key)
  if (!requested) return all
  const wanted = requested
    .split(',')
    .map((s) => s.trim())
    .filter((k) => entityColumnSql(entity, k))
  return wanted.length ? wanted : all
}

const KIND_BY_KEY = (entity: ReportEntity): Map<string, ReportColumnKind> =>
  new Map(entity.columns.map((c) => [c.key, c.kind]))

/** JSON-friendly value: timestamps → ISO, numerics → number, else as-is. */
function formatValue(value: unknown, kind: ReportColumnKind | undefined): unknown {
  if (value === null || typeof value === 'undefined') return null
  if (value instanceof Date) return value.toISOString()
  if (kind === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  }
  return value
}

export async function readEntityRows(
  ctx: RequestContext,
  entity: ReportEntity,
  params: URLSearchParams,
): Promise<EntityPage> {
  const limit = clampInt(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
  const offset = clampInt(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const fields = resolveFields(entity, params)
  const filters = buildFilters(entity, params)
  // Recordable entities (physical tables) always return their own `id` first.
  const idCol = recordIdColumn(entity)

  const sortReq = params.get('sort')
  const sortCol =
    (sortReq && entityColumnSql(entity, sortReq)) ||
    (entity.defaultSort && entityColumnSql(entity, entity.defaultSort.column)) ||
    null
  const orderReq = params.get('order')
  const dir =
    orderReq === 'asc' || orderReq === 'desc' ? orderReq : (entity.defaultSort?.direction ?? 'desc')

  const where = compileFlatFilters(entity, filters)
  const whereSql = where ? sql.join([sql.raw('WHERE'), where], sql.raw(' ')) : sql.raw('')
  const idSelect = idCol ? [`"${entity.table}"."${idCol}" AS "id"`] : []
  const selectList = sql.raw(
    [
      ...idSelect,
      ...fields.map((c) => `"${entity.table}"."${entityColumnSql(entity, c)}" AS "${c}"`),
    ].join(', '),
  )
  const orderSql = sortCol
    ? sql.raw(`ORDER BY "${entity.table}"."${sortCol}" ${dir === 'asc' ? 'ASC' : 'DESC'}`)
    : sql.raw('')

  const dataQuery = sql.join(
    [
      sql.raw('SELECT'),
      selectList,
      sql.raw(`FROM "${entity.table}"`),
      whereSql,
      orderSql,
      sql.raw(`LIMIT ${limit} OFFSET ${offset}`),
    ],
    sql.raw(' '),
  )
  const countQuery = sql.join(
    [sql.raw(`SELECT COUNT(*)::int AS "n" FROM "${entity.table}"`), whereSql],
    sql.raw(' '),
  )

  const { rows, total } = await ctx.db(async (tx) => {
    const dataResult = (await tx.execute(dataQuery)) as unknown
    const countResult = (await tx.execute(countQuery)) as unknown
    const totalRow = extractRows(countResult)[0] as { n?: number } | undefined
    return { rows: extractRows(dataResult), total: Number(totalRow?.n ?? 0) }
  })

  const kinds = KIND_BY_KEY(entity)
  const data = rows.map((row) => {
    const out: Record<string, unknown> = {}
    if (idCol) out.id = row.id ?? null
    for (const key of fields) out[key] = formatValue(row[key], kinds.get(key))
    return out
  })

  return {
    data,
    pagination: { limit, offset, total, hasMore: offset + data.length < total },
  }
}

/**
 * Fetch a single record by id, RLS-scoped to the caller's tenant. Returns null
 * when the entity is list-only (a view) or no row matches. The caller validates
 * the id is a uuid before this runs.
 */
export async function getEntityRecord(
  ctx: RequestContext,
  entity: ReportEntity,
  id: string,
): Promise<Record<string, unknown> | null> {
  const idCol = recordIdColumn(entity)
  if (!idCol) return null
  const fields = entity.columns.map((c) => c.key)
  const selectList = sql.raw(
    [
      `"${entity.table}"."${idCol}" AS "id"`,
      ...fields.map((c) => `"${entity.table}"."${entityColumnSql(entity, c)}" AS "${c}"`),
    ].join(', '),
  )
  const query = sql.join(
    [
      sql.raw('SELECT'),
      selectList,
      sql.raw(`FROM "${entity.table}" WHERE "${entity.table}"."${idCol}" =`),
      sql`${id}`,
      sql.raw('LIMIT 1'),
    ],
    sql.raw(' '),
  )
  const rows = await ctx.db(async (tx) => extractRows((await tx.execute(query)) as unknown))
  const row = rows[0]
  if (!row) return null
  const kinds = KIND_BY_KEY(entity)
  const out: Record<string, unknown> = { id: row.id ?? null }
  for (const key of fields) out[key] = formatValue(row[key], kinds.get(key))
  return out
}
