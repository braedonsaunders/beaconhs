// Read one exposed entity as clean JSON rows. Safety comes entirely from the
// reports registry: table + column identifiers are resolved through the entity
// whitelist (never interpolated from input) and filter values bind as
// parameters via @beaconhs/reports' canonical rule-tree compiler. The caller's ctx.db is
// already RLS-bound to the key's tenant.

import { getTableColumns, getTableName, is, sql, type SQL } from 'drizzle-orm'
import { PgTable } from 'drizzle-orm/pg-core'
import type { RequestContext } from '@beaconhs/tenant'
import * as dbSchema from '@beaconhs/db/schema'
import type { ReportFilterOperator, ReportRule } from '@beaconhs/db/schema'
import {
  augmentReportEntityWithCustomFields,
  columnRef,
  compileRuleGroup,
  entityColumnSql,
  extractRows,
  type ReportColumnKind,
  type ReportEntity,
} from '@beaconhs/reports'
import { ApiError } from './errors'
import { recordIdColumn } from './records'
import { documentReadFilter } from '../assistant/doc-access'

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

type EntityPage = {
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
type ApiFilter = { column: string; op: ReportFilterOperator; value?: ReportRule['value'] }

function buildFilters(entity: ReportEntity, params: URLSearchParams): ApiFilter[] {
  const filters: ApiFilter[] = []
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

/** Physical tables carrying a `deleted_at` soft-delete column, derived from the
 *  Drizzle schema so the public API excludes archived rows exactly like the UI
 *  (which filters `isNull(deletedAt)` everywhere). */
const SOFT_DELETE_TABLES: ReadonlySet<string> = (() => {
  const names = new Set<string>()
  for (const value of Object.values(dbSchema)) {
    if (!is(value, PgTable)) continue
    const table = value as PgTable
    if ('deletedAt' in getTableColumns(table)) names.add(getTableName(table))
  }
  return names
})()

/** `deleted_at IS NULL` predicate for soft-deletable entities, else null. */
function notDeletedSql(entity: ReportEntity): SQL | null {
  return SOFT_DELETE_TABLES.has(entity.table)
    ? sql.raw(`"${entity.table}"."deleted_at" IS NULL`)
    : null
}

/** Entity-specific visibility that is stricter than tenant RLS. Document read
 * keys see the same published library as human readers; only a key carrying
 * documents.manage may inspect draft or archived document metadata. */
function entityVisibilitySql(ctx: RequestContext, entity: ReportEntity): SQL | null {
  if (entity.key !== 'documents') return null
  return documentReadFilter(ctx) ?? null
}

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
  baseEntity: ReportEntity,
  params: URLSearchParams,
): Promise<EntityPage> {
  // Append the tenant's custom-field columns so they're selectable, filterable
  // and sortable through the public API like any other column.
  const entity = await ctx.db((tx) => augmentReportEntityWithCustomFields(tx, baseEntity))
  const limit = clampInt(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT)
  const offset = clampInt(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)
  const fields = resolveFields(entity, params)
  const filters = buildFilters(entity, params)
  const filterSql = filters.length
    ? compileRuleGroup(entity, {
        combinator: 'and',
        rules: filters.map(({ column, ...filter }) => ({ field: column, ...filter })),
      })
    : null
  // Recordable entities (physical tables) always return their own `id` first.
  const idCol = recordIdColumn(entity)

  const sortReq = params.get('sort')
  const sortKey =
    (sortReq && entityColumnSql(entity, sortReq) ? sortReq : null) ??
    (entity.defaultSort && entityColumnSql(entity, entity.defaultSort.column)
      ? entity.defaultSort.column
      : null)
  const orderReq = params.get('order')
  const dir =
    orderReq === 'asc' || orderReq === 'desc' ? orderReq : (entity.defaultSort?.direction ?? 'desc')

  // Soft-deleted rows are never exposed through the public API; the filters
  // from compileRuleGroup are AND-joined so composing here is safe.
  const conditions = [notDeletedSql(entity), entityVisibilitySql(ctx, entity), filterSql].filter(
    (c): c is SQL => c !== null,
  )
  const whereSql = conditions.length
    ? sql.join([sql.raw('WHERE'), sql.join(conditions, sql.raw(' AND '))], sql.raw(' '))
    : sql.raw('')
  const idSelect = idCol ? [`"${entity.table}"."${idCol}" AS "id"`] : []
  const selectList = sql.raw(
    [...idSelect, ...fields.map((c) => `${columnRef(entity, c)} AS "${c}"`)].join(', '),
  )
  const orderSql = sortKey
    ? sql.raw(`ORDER BY ${columnRef(entity, sortKey)} ${dir === 'asc' ? 'ASC' : 'DESC'}`)
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
    // The selected keys come from the entity registry, but custom-field keys
    // are still tenant-authored. fromEntries creates own data properties and
    // cannot trigger Object.prototype setters such as "__proto__".
    return Object.fromEntries([
      ...(idCol ? ([['id', row.id ?? null]] as Array<[string, unknown]>) : []),
      ...fields.map((key): [string, unknown] => [key, formatValue(row[key], kinds.get(key))]),
    ])
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
  baseEntity: ReportEntity,
  id: string,
): Promise<Record<string, unknown> | null> {
  const idCol = recordIdColumn(baseEntity)
  if (!idCol) return null
  const entity = await ctx.db((tx) => augmentReportEntityWithCustomFields(tx, baseEntity))
  const fields = entity.columns.map((c) => c.key)
  const selectList = sql.raw(
    [
      `"${entity.table}"."${idCol}" AS "id"`,
      ...fields.map((c) => `${columnRef(entity, c)} AS "${c}"`),
    ].join(', '),
  )
  const fixedConditions = [notDeletedSql(entity), entityVisibilitySql(ctx, entity)].filter(
    (condition): condition is SQL => condition !== null,
  )
  const query = sql.join(
    [
      sql.raw('SELECT'),
      selectList,
      sql.raw(`FROM "${entity.table}" WHERE "${entity.table}"."${idCol}" =`),
      sql`${id}`,
      ...fixedConditions.flatMap((condition) => [sql.raw('AND'), condition]),
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
