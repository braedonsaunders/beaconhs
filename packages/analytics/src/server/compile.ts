// BHQL → Postgres SQL compiler. Pure (no execution): turns a validated
// `BhqlQuery` into a single parameterized `SQL` statement plus the result-column
// metadata the executor/viz layer need.
//
// Injection safety is inherited wholesale from the report executor: physical
// identifiers come ONLY from the entity whitelist (`entityColumnSql`), output
// aliases are slug-validated upstream, GROUP BY / ORDER BY use integer ordinals,
// and the WHERE clause is compiled by the reused `compileRuleGroup` (values bind
// as parameters). No untrusted string ever reaches `sql.raw` except a whitelisted
// physical column name or a validated alias.

import { sql, type SQL } from 'drizzle-orm'
import {
  entityColumn,
  entityColumnSql,
  type ReportColumnKind,
  type ReportEntity,
  type ReportEntityColumn,
} from '@beaconhs/reports/entities'
import { compileRuleGroup } from '@beaconhs/reports/filters'
import type { BhqlBreakout, BhqlCalcMeasure, BhqlMeasure, BhqlQuery } from '@beaconhs/db/schema'
import { analyticsColumn, type AnalyticsColumn, type AnalyticsEntity } from '../semantic'
import type { ResultColumn, ResultDataType } from '../result'
import { discoverEntityMap } from './discover'

const DEFAULT_LIMIT = 1000
const HARD_MAX = 50_000

export type CompiledBhql = {
  sql: SQL
  columns: ResultColumn[]
  effectiveLimit: number
}

function dataTypeOf(kind: ReportColumnKind): ResultDataType {
  switch (kind) {
    case 'number':
      return 'number'
    case 'date':
      return 'date'
    case 'timestamp':
      return 'timestamp'
    default:
      return 'string'
  }
}

type JoinSpec = {
  table: string
  alias: string
  /** Alias of the table on the LEFT of the ON clause (the base table for a
   *  first-hop join, or the parent join's alias for a deeper hop). */
  leftAlias: string
  localCol: string
  foreignCol: string
}

/** Per-compilation context: the source entity, the discovered registry (for
 *  following FK relations) and the accumulating set of LEFT JOINs. */
type CompileCtx = {
  entity: ReportEntity
  aEntity: AnalyticsEntity
  entityMap: Record<string, AnalyticsEntity>
  joins: Map<string, JoinSpec>
}

/** Resolve a field ref to a quoted physical column. A ref shaped
 *  "<via>.<column>" follows the foreign-key relation `<via>` to `<column>` on
 *  the related entity, registering a LEFT JOIN.
 *
 *  SECURITY: a relation only ever targets a discovered RLS-safe entity, and both
 *  the local FK column and the remote column are re-derived through the entity
 *  whitelist — no caller-supplied string reaches raw SQL unchecked, and you can
 *  never join into a non-tenant-isolated table. Returns null when unresolvable
 *  (defence; the validator has already run). */
function colSqlOf(ctx: CompileCtx, ref: string): SQL | null {
  const segs = ref.split('.')
  if (segs.length === 1) {
    const col = entityColumnSql(ctx.entity, ref)
    return col ? sql.raw(`"${ctx.entity.table}"."${col}"`) : null
  }
  // Multi-hop: walk each "via" segment, following a relation on the CURRENT
  // entity and registering one LEFT JOIN per path prefix (so j_a then j_a__b),
  // until the final segment names a column on the last related entity.
  let curEntity: AnalyticsEntity = ctx.aEntity
  let curAlias = ctx.entity.table
  let pathKey = ''
  for (let i = 0; i < segs.length - 1; i++) {
    const via = segs[i]!
    const rel = (curEntity.relations ?? []).find((r) => r.via === via)
    if (!rel) return null
    const target = ctx.entityMap[rel.target]
    if (!target) return null
    const localCol = entityColumnSql(curEntity, via)
    if (!localCol) return null
    pathKey = pathKey ? `${pathKey}.${via}` : via
    const alias = `j_${pathKey.replace(/\./g, '__')}`
    if (!ctx.joins.has(pathKey)) {
      ctx.joins.set(pathKey, {
        table: target.table,
        alias,
        leftAlias: curAlias,
        localCol,
        foreignCol: rel.foreignColumn,
      })
    }
    curEntity = target
    curAlias = alias
  }
  const targetCol = entityColumnSql(curEntity, segs[segs.length - 1]!)
  return targetCol ? sql.raw(`"${curAlias}"."${targetCol}"`) : null
}

/** Resolve a field ref to physical SQL or throw (defence in depth). */
function colSqlOrThrow(ctx: CompileCtx, ref: string): SQL {
  const s = colSqlOf(ctx, ref)
  if (!s) throw new Error(`Unknown field "${ref}" on ${ctx.entity.key}`)
  return s
}

/** Column metadata (label / kind / semantic type) for a field ref, following a
 *  FK relation for "<via>.<column>" refs. */
function colMetaOf(
  ctx: CompileCtx,
  ref: string,
): { col: ReportEntityColumn; aCol: AnalyticsColumn | null } | null {
  const segs = ref.split('.')
  if (segs.length === 1) {
    const col = entityColumn(ctx.entity, ref)
    return col ? { col, aCol: analyticsColumn(ctx.aEntity, ref) } : null
  }
  let curEntity: AnalyticsEntity = ctx.aEntity
  for (let i = 0; i < segs.length - 1; i++) {
    const rel = (curEntity.relations ?? []).find((r) => r.via === segs[i])
    if (!rel) return null
    const target = ctx.entityMap[rel.target]
    if (!target) return null
    curEntity = target
  }
  const key = segs[segs.length - 1]!
  const col = entityColumn(curEntity, key)
  return col ? { col, aCol: analyticsColumn(curEntity, key) } : null
}

function aliased(expr: SQL, alias: string): SQL {
  return sql.join([expr, sql.raw(` AS "${alias}"`)], sql.raw(''))
}

function breakoutColumn(ctx: CompileCtx, b: BhqlBreakout): { select: SQL; column: ResultColumn } {
  const meta = colMetaOf(ctx, b.field)
  if (!meta) throw new Error(`Unknown breakout field "${b.field}"`)
  const { col, aCol } = meta
  const base = colSqlOrThrow(ctx, b.field)

  if (b.bin?.kind === 'temporal') {
    // unit is one of 5 validated literals — safe to inline.
    const expr = sql.join(
      [sql.raw(`date_trunc('${b.bin.unit}', `), base, sql.raw(')')],
      sql.raw(''),
    )
    return {
      select: aliased(expr, b.alias),
      column: {
        key: b.alias,
        label: aCol?.label ?? col.label,
        role: 'dimension',
        semanticType: 'temporal',
        dataType: 'timestamp',
        bin: b.bin,
      },
    }
  }
  if (b.bin?.kind === 'numeric') {
    throw new Error(
      'Numeric binning is not available yet — group by the raw value or a time bucket',
    )
  }

  return {
    select: aliased(base, b.alias),
    column: {
      key: b.alias,
      label: aCol?.label ?? col.label,
      role: 'dimension',
      semanticType: aCol?.semanticType ?? 'dimension',
      dataType: dataTypeOf(col.kind),
    },
  }
}

function humanizeAlias(s: string): string {
  const t = s.replace(/_/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** The raw (unaliased) aggregate SQL for a base measure + its result column.
 *  A conditional aggregate (`m.filter`) compiles to `<agg> FILTER (WHERE …)` so a
 *  "count of recordable incidents" / "count of compliant people" is one measure. */
function baseMeasureExpr(ctx: CompileCtx, m: BhqlMeasure): { expr: SQL; column: ResultColumn } {
  const colLabel = m.field ? (colMetaOf(ctx, m.field)?.col.label ?? m.field) : ''
  let core: SQL
  let cast: 'bigint' | 'numeric' | null = null
  let label: string
  let dataType: ResultDataType = 'number'

  switch (m.fn) {
    case 'count':
      core = sql.raw('COUNT(*)')
      cast = 'bigint'
      label = 'Count'
      break
    case 'count_distinct':
      core = sql.join(
        [sql.raw('COUNT(DISTINCT '), colSqlOrThrow(ctx, m.field!), sql.raw(')')],
        sql.raw(''),
      )
      cast = 'bigint'
      label = `Distinct ${colLabel}`
      break
    case 'sum':
      core = sql.join([sql.raw('SUM('), colSqlOrThrow(ctx, m.field!), sql.raw(')')], sql.raw(''))
      cast = 'numeric'
      label = `Sum of ${colLabel}`
      break
    case 'avg':
      core = sql.join([sql.raw('AVG('), colSqlOrThrow(ctx, m.field!), sql.raw(')')], sql.raw(''))
      cast = 'numeric'
      label = `Average ${colLabel}`
      break
    case 'min': {
      core = sql.join([sql.raw('MIN('), colSqlOrThrow(ctx, m.field!), sql.raw(')')], sql.raw(''))
      dataType = dataTypeOf(colMetaOf(ctx, m.field!)?.col.kind ?? 'number')
      label = `Min ${colLabel}`
      break
    }
    case 'max': {
      core = sql.join([sql.raw('MAX('), colSqlOrThrow(ctx, m.field!), sql.raw(')')], sql.raw(''))
      dataType = dataTypeOf(colMetaOf(ctx, m.field!)?.col.kind ?? 'number')
      label = `Max ${colLabel}`
      break
    }
    default:
      throw new Error(`Unknown aggregation "${m.fn}"`)
  }

  if (m.filter) {
    const sub = compileRuleGroup(ctx.entity, m.filter, (c) => colSqlOf(ctx, c))
    if (sub) core = sql.join([core, sql.raw(' FILTER (WHERE '), sub, sql.raw(')')], sql.raw(''))
  }
  const expr = cast ? sql.join([sql.raw('('), core, sql.raw(`)::${cast}`)], sql.raw('')) : core
  return {
    expr,
    column: { key: m.alias, label, role: 'measure', semanticType: 'measure', dataType },
  }
}

/** A calculated measure — numerator / denominator × multiplier — inlining the
 *  referenced base measures' aggregate SQL (a SELECT alias can't be referenced in
 *  the same SELECT). Numerator is cast to numeric to avoid integer division. */
function calcMeasureColumn(
  m: BhqlCalcMeasure,
  exprMap: Map<string, SQL>,
): { select: SQL; column: ResultColumn } {
  const num = exprMap.get(m.numerator)
  if (!num)
    throw new Error(`Calculated measure "${m.alias}" references unknown measure "${m.numerator}"`)
  let expr: SQL = sql.join([sql.raw('('), num, sql.raw(')::numeric')], sql.raw(''))
  if (m.denominator) {
    const den = exprMap.get(m.denominator)
    if (!den) {
      throw new Error(
        `Calculated measure "${m.alias}" references unknown measure "${m.denominator}"`,
      )
    }
    expr = sql.join([expr, sql.raw(' / NULLIF(('), den, sql.raw('), 0)')], sql.raw(''))
  }
  if (typeof m.multiplier === 'number' && m.multiplier !== 1) {
    expr = sql.join([sql.raw('('), expr, sql.raw(`) * ${m.multiplier}`)], sql.raw(''))
  }
  return {
    select: aliased(expr, m.alias),
    column: {
      key: m.alias,
      label: humanizeAlias(m.alias),
      role: 'measure',
      semanticType: 'measure',
      dataType: 'number',
    },
  }
}

export function compileBhql(
  query: BhqlQuery,
  opts: { maxRows?: number; entityMap?: Record<string, AnalyticsEntity> } = {},
): CompiledBhql {
  const stage = query.stages[0]
  if (!stage) throw new Error('Query has no stage')
  const entityMap = opts.entityMap ?? discoverEntityMap()
  const aEntity = entityMap[stage.source]
  if (!aEntity) throw new Error(`Unknown source entity "${stage.source}"`)
  // The discovered AnalyticsEntity carries both the report columns (table/sql) and
  // the semantic metadata, so it serves as both `entity` and `aEntity`.
  const entity: ReportEntity = aEntity

  // Foreign-key joins are discovered lazily while resolving field refs (colSqlOf)
  // across breakouts, measures and filters, then emitted as LEFT JOINs below.
  const joins = new Map<string, JoinSpec>()
  const ctx: CompileCtx = { entity, aEntity, entityMap, joins }

  const breakouts = stage.breakouts ?? []
  const allMeasures = stage.aggregations ?? []
  const baseMeasures = allMeasures.filter((m): m is BhqlMeasure => m.kind !== 'calc')
  const calcMeasures = allMeasures.filter((m): m is BhqlCalcMeasure => m.kind === 'calc')
  const rawColumns = stage.columns ?? []
  const isAggregate = allMeasures.length > 0 || breakouts.length > 0

  const requested = typeof stage.limit === 'number' ? stage.limit : DEFAULT_LIMIT
  let effectiveLimit = Math.min(Math.max(Math.trunc(requested), 1), HARD_MAX)
  if (opts.maxRows) effectiveLimit = Math.min(effectiveLimit, opts.maxRows)

  const where = stage.filter
    ? compileRuleGroup(entity, stage.filter, (c) => colSqlOf(ctx, c))
    : null
  const whereSql = where ? sql.join([sql.raw('WHERE '), where], sql.raw('')) : null

  const selects: SQL[] = []
  const columns: ResultColumn[] = []

  if (isAggregate) {
    for (const b of breakouts) {
      const { select, column } = breakoutColumn(ctx, b)
      selects.push(select)
      columns.push(column)
    }
    // "group by X with no measures" → an implicit row count so a bare breakout
    // still yields a sensible table.
    let bases = baseMeasures
    if (bases.length === 0 && calcMeasures.length === 0) {
      const alias = breakouts.some((b) => b.alias === 'count') ? 'n' : 'count'
      bases = [{ fn: 'count', alias }]
    }
    const exprMap = new Map<string, SQL>()
    for (const m of bases) {
      const { expr, column } = baseMeasureExpr(ctx, m)
      exprMap.set(m.alias, expr)
      selects.push(aliased(expr, m.alias))
      columns.push(column)
    }
    for (const m of calcMeasures) {
      const { select, column } = calcMeasureColumn(m, exprMap)
      selects.push(select)
      columns.push(column)
    }
  } else {
    const cols = rawColumns.length ? rawColumns : entity.columns.map((c) => c.key)
    for (const key of cols) {
      const meta = colMetaOf(ctx, key)
      if (!meta) continue
      const { col, aCol } = meta
      selects.push(aliased(colSqlOrThrow(ctx, key), key))
      columns.push({
        key,
        label: aCol?.label ?? col.label,
        role: aCol?.canMeasure ? 'measure' : 'dimension',
        semanticType: aCol?.semanticType ?? 'dimension',
        dataType: dataTypeOf(col.kind),
      })
    }
  }

  if (selects.length === 0) throw new Error('Query selects no columns')

  // Breakout selects come first → GROUP BY their 1-based ordinals.
  const groupBy =
    isAggregate && breakouts.length
      ? sql.raw(`GROUP BY ${breakouts.map((_, i) => i + 1).join(', ')}`)
      : null

  const ordinalOf = new Map<string, number>()
  columns.forEach((c, i) => ordinalOf.set(c.key, i + 1))
  const orderParts: string[] = []
  for (const o of stage.orderBy ?? []) {
    const ord = ordinalOf.get(o.ref)
    if (ord) orderParts.push(`${ord} ${o.direction === 'asc' ? 'ASC' : 'DESC'}`)
  }
  if (orderParts.length === 0 && isAggregate && breakouts.length) orderParts.push('1 ASC')
  const orderBy = orderParts.length ? sql.raw(`ORDER BY ${orderParts.join(', ')}`) : null

  // Each discovered FK relation → one LEFT JOIN. The remote table is FORCE-RLS,
  // so under the caller's RLS transaction it is independently scoped to the
  // tenant; a missing/foreign row simply yields NULL (LEFT JOIN).
  const joinClauses = [...joins.values()].map((j) =>
    sql.raw(
      `LEFT JOIN "${j.table}" "${j.alias}" ON "${j.leftAlias}"."${j.localCol}" = "${j.alias}"."${j.foreignCol}"`,
    ),
  )

  const parts: (SQL | null)[] = [
    sql.raw('SELECT'),
    sql.join(selects, sql.raw(', ')),
    sql.raw(`FROM "${entity.table}"`),
    ...joinClauses,
    whereSql,
    groupBy,
    orderBy,
    sql.raw(`LIMIT ${effectiveLimit}`),
  ]
  const statement = sql.join(
    parts.filter((p): p is SQL => p != null),
    sql.raw(' '),
  )

  return { sql: statement, columns, effectiveLimit }
}
