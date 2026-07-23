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
  columnRef,
  entityColumn,
  entityColumnSql,
  type ReportColumnKind,
  type ReportEntity,
  type ReportEntityColumn,
} from '@beaconhs/reports/entities'
import { compileRuleGroup } from './filter-sql'
import type {
  BhqlBreakout,
  BhqlCalcMeasure,
  BhqlExpr,
  BhqlExprMeasure,
  BhqlMeasure,
  BhqlQuery,
  ReportRuleGroup,
} from '@beaconhs/db/schema'
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
  /** Spine mode override: resolve an alias-qualified ref ("<alias>.<col>")
   *  against the spine's sources instead of the single base entity. When set, it
   *  fully replaces the default FK-path resolution. */
  resolve?: (ref: string) => SQL | null
  resolveMeta?: (ref: string) => { col: ReportEntityColumn; aCol: AnalyticsColumn | null } | null
  /** Array/jsonb UNNEST lateral joins collected while compiling breakouts, then
   *  emitted into the FROM by the compile path. */
  unnests: { alias: string; sql: SQL }[]
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
  if (ctx.resolve) return ctx.resolve(ref)
  const segs = ref.split('.')
  if (segs.length === 1) {
    // columnRef returns the synthetic `expr` for custom-field columns, else the
    // default `"table"."col"`.
    const r = columnRef(ctx.entity, ref)
    return r ? sql.raw(r) : null
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
  if (ctx.resolveMeta) return ctx.resolveMeta(ref)
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

// --- Custom-expression compiler ---------------------------------------------
// Compiles a BhqlExpr to SQL. SECURITY: column refs go through the whitelist
// (colSqlOrThrow), string/number literals bind as parameters, and the ONLY raw
// fragments are operators/units/function names taken from typed unions or the
// validated allow-lists below — no caller string ever reaches sql.raw unchecked.

const EXPR_DATE_UNITS = new Set(['day', 'week', 'month', 'quarter', 'year', 'hour', 'minute'])
const EXPR_DATE_PARTS = new Set([
  'dow',
  'doy',
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'hour',
  'minute',
])
/** Whitelisted scalar functions → arity (null = variadic, ≥1). */
const EXPR_FUNCTIONS: Record<string, { min: number; max: number }> = {
  now: { min: 0, max: 0 },
  current_date: { min: 0, max: 0 },
  coalesce: { min: 2, max: 99 },
  nullif: { min: 2, max: 2 },
  abs: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  ceil: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  power: { min: 2, max: 2 },
  sqrt: { min: 1, max: 1 },
  lower: { min: 1, max: 1 },
  upper: { min: 1, max: 1 },
  length: { min: 1, max: 1 },
  trim: { min: 1, max: 1 },
  concat: { min: 2, max: 99 },
  datediff: { min: 3, max: 3 },
  datetrunc: { min: 2, max: 2 },
  datepart: { min: 2, max: 2 },
}

function paren(s: SQL): SQL {
  return sql.join([sql.raw('('), s, sql.raw(')')], sql.raw(''))
}
function fnCall(name: string, args: SQL[]): SQL {
  return sql.join([sql.raw(`${name}(`), sql.join(args, sql.raw(', ')), sql.raw(')')], sql.raw(''))
}
function litStr(e: BhqlExpr | undefined): string {
  if (e && e.ex === 'lit' && typeof e.value === 'string') return e.value
  throw new Error('expected a string-literal argument')
}

/** datediff(unit, start, end) → an integer count of whole units between two
 *  date/timestamp expressions. `unit` is validated against EXPR_DATE_UNITS. */
function dateDiffSql(unit: string, start: SQL, end: SQL): SQL {
  switch (unit) {
    case 'day':
      return paren(sql.join([end, sql.raw('::date - '), start, sql.raw('::date')], sql.raw('')))
    case 'week':
      return paren(
        sql.join(
          [sql.raw('('), end, sql.raw('::date - '), start, sql.raw('::date) / 7')],
          sql.raw(''),
        ),
      )
    case 'hour':
      return paren(
        sql.join(
          [sql.raw('EXTRACT(EPOCH FROM ('), end, sql.raw(' - '), start, sql.raw(')) / 3600')],
          sql.raw(''),
        ),
      )
    case 'minute':
      return paren(
        sql.join(
          [sql.raw('EXTRACT(EPOCH FROM ('), end, sql.raw(' - '), start, sql.raw(')) / 60')],
          sql.raw(''),
        ),
      )
    case 'month':
    case 'quarter': {
      const months = paren(
        sql.join(
          [
            sql.raw('(EXTRACT(YEAR FROM age('),
            end,
            sql.raw(', '),
            start,
            sql.raw(')) * 12 + EXTRACT(MONTH FROM age('),
            end,
            sql.raw(', '),
            start,
            sql.raw(')))::int'),
          ],
          sql.raw(''),
        ),
      )
      return unit === 'quarter' ? paren(sql.join([months, sql.raw(' / 3')], sql.raw(''))) : months
    }
    case 'year':
      return paren(
        sql.join(
          [sql.raw('EXTRACT(YEAR FROM age('), end, sql.raw(', '), start, sql.raw('))::int')],
          sql.raw(''),
        ),
      )
    default:
      throw new Error(`Unknown datediff unit "${unit}"`)
  }
}

function compileFn(ctx: CompileCtx, fn: string, args: BhqlExpr[]): SQL {
  const meta = EXPR_FUNCTIONS[fn]
  if (!meta) throw new Error(`Unknown function "${fn}"`)
  if (args.length < meta.min || args.length > meta.max)
    throw new Error(`Function "${fn}" takes ${meta.min}..${meta.max} args (got ${args.length})`)
  if (fn === 'now') return sql.raw('now()')
  if (fn === 'current_date') return sql.raw('CURRENT_DATE')
  if (fn === 'datediff') {
    const unit = litStr(args[0])
    if (!EXPR_DATE_UNITS.has(unit)) throw new Error(`Bad datediff unit "${unit}"`)
    return dateDiffSql(unit, compileExpr(ctx, args[1]!), compileExpr(ctx, args[2]!))
  }
  if (fn === 'datetrunc') {
    const unit = litStr(args[0])
    if (!EXPR_DATE_UNITS.has(unit)) throw new Error(`Bad datetrunc unit "${unit}"`)
    return sql.join(
      [sql.raw(`date_trunc('${unit}', `), compileExpr(ctx, args[1]!), sql.raw(')')],
      sql.raw(''),
    )
  }
  if (fn === 'datepart') {
    const part = litStr(args[0])
    if (!EXPR_DATE_PARTS.has(part)) throw new Error(`Bad datepart "${part}"`)
    return sql.join(
      [sql.raw(`EXTRACT(${part} FROM `), compileExpr(ctx, args[1]!), sql.raw(')::int')],
      sql.raw(''),
    )
  }
  // Plain SQL functions whose name == the (whitelisted) key, upper-cased.
  return fnCall(
    fn.toUpperCase(),
    args.map((a) => compileExpr(ctx, a)),
  )
}

function compileAggExpr(ctx: CompileCtx, e: Extract<BhqlExpr, { ex: 'agg' }>): SQL {
  let core: SQL
  if (e.fn === 'count') core = sql.raw('COUNT(*)')
  else if (e.fn === 'count_distinct')
    core = sql.join(
      [sql.raw('COUNT(DISTINCT '), compileExpr(ctx, e.arg!), sql.raw(')')],
      sql.raw(''),
    )
  // fn is a typed BhqlAggFn union → safe to upper-case into SQL.
  else core = fnCall(e.fn.toUpperCase(), [compileExpr(ctx, e.arg!)])
  if (e.filter) {
    const sub = compileRuleGroup(ctx.entity, e.filter, (c) => colSqlOf(ctx, c))
    if (sub) core = sql.join([core, sql.raw(' FILTER (WHERE '), sub, sql.raw(')')], sql.raw(''))
  }
  // No blanket ::numeric cast — an aggregate keeps its natural type (e.g.
  // max(timestamp) stays a timestamp); the enclosing expression casts as needed.
  return paren(core)
}

function compileExpr(ctx: CompileCtx, e: BhqlExpr): SQL {
  switch (e.ex) {
    case 'field':
      return colSqlOrThrow(ctx, e.field)
    case 'lit':
      if (e.value === null) return sql.raw('NULL')
      if (typeof e.value === 'boolean') return sql.raw(e.value ? 'TRUE' : 'FALSE')
      // Finite numbers inline as SQL literals (safe — zod-validated numbers) so an
      // expression like `CURRENT_DATE + 90` stays unambiguous; a bound `$n` param
      // there leaves the operator type undecidable (date + unknown → 42725).
      if (typeof e.value === 'number' && Number.isFinite(e.value)) return sql.raw(String(e.value))
      // String literals inline as quoted SQL literals (single quotes doubled) —
      // exactly what a hand-written CASE does. A bound param in an all-param CASE
      // leaves the result type undetermined (42P18), and an inlined literal also
      // coerces cleanly to an enum column. Injection-safe: these are zod-validated
      // AST literals and quote-doubling is sound under standard_conforming_strings.
      if (typeof e.value === 'string') return sql.raw(`'${e.value.replace(/'/g, "''")}'`)
      return sql`${e.value}` // any non-finite number binds as a parameter
    case 'arith': {
      const right =
        e.op === '/'
          ? sql.join([sql.raw('NULLIF('), compileExpr(ctx, e.right), sql.raw(', 0)')], sql.raw(''))
          : compileExpr(ctx, e.right)
      return paren(sql.join([compileExpr(ctx, e.left), sql.raw(` ${e.op} `), right], sql.raw('')))
    }
    case 'compare':
      return paren(
        sql.join(
          [
            compileExpr(ctx, e.left),
            sql.raw(` ${e.op === '!=' ? '<>' : e.op} `),
            compileExpr(ctx, e.right),
          ],
          sql.raw(''),
        ),
      )
    case 'isnull':
      return paren(
        sql.join(
          [compileExpr(ctx, e.arg), sql.raw(e.negated ? ' IS NOT NULL' : ' IS NULL')],
          sql.raw(''),
        ),
      )
    case 'logic':
      if (e.op === 'not')
        return paren(sql.join([sql.raw('NOT '), compileExpr(ctx, e.args[0]!)], sql.raw('')))
      return paren(
        sql.join(
          e.args.map((a) => compileExpr(ctx, a)),
          sql.raw(e.op === 'and' ? ' AND ' : ' OR '),
        ),
      )
    case 'case': {
      const parts: SQL[] = [sql.raw('CASE')]
      for (const b of e.branches) {
        parts.push(
          sql.raw(' WHEN '),
          compileExpr(ctx, b.when),
          sql.raw(' THEN '),
          compileExpr(ctx, b.then),
        )
      }
      if (e.else !== undefined) parts.push(sql.raw(' ELSE '), compileExpr(ctx, e.else))
      parts.push(sql.raw(' END'))
      return sql.join(parts, sql.raw(''))
    }
    case 'call':
      return compileFn(ctx, e.fn, e.args)
    case 'agg':
      return compileAggExpr(ctx, e)
  }
}

function breakoutColumn(ctx: CompileCtx, b: BhqlBreakout): { select: SQL; column: ResultColumn } {
  // Unnest an array / jsonb-array column to one row per element (CROSS JOIN
  // LATERAL), then group by the element. The lateral is collected on the ctx and
  // emitted into the FROM by the compile path.
  if (b.unnest) {
    if (!b.field) throw new Error('An unnest breakout needs a field')
    const arr = colSqlOrThrow(ctx, b.field)
    const ualias = `u_${b.alias}`
    const fn = b.unnest === 'jsonb' ? 'jsonb_array_elements_text' : 'unnest'
    ctx.unnests.push({
      alias: ualias,
      sql: sql.join(
        [sql.raw(`CROSS JOIN LATERAL ${fn}(`), arr, sql.raw(`) AS "${ualias}"("val")`)],
        sql.raw(''),
      ),
    })
    const meta = colMetaOf(ctx, b.field)
    return {
      select: aliased(sql.raw(`"${ualias}"."val"`), b.alias),
      column: {
        key: b.alias,
        label: meta?.aCol?.label ?? meta?.col.label ?? humanizeAlias(b.alias),
        role: 'dimension',
        semanticType: 'dimension',
        dataType: 'string',
      },
    }
  }
  // Computed (expression) breakout — e.g. a CASE age bucket. Grouped by the
  // expression itself (no column metadata / temporal bin).
  if (b.expr) {
    return {
      select: aliased(compileExpr(ctx, b.expr), b.alias),
      column: {
        key: b.alias,
        label: humanizeAlias(b.alias),
        role: 'dimension',
        semanticType: 'dimension',
        dataType: 'string',
      },
    }
  }
  const field = b.field
  if (!field) throw new Error('A breakout needs a field or an expression')
  const meta = colMetaOf(ctx, field)
  if (!meta) throw new Error(`Unknown breakout field "${field}"`)
  const { col, aCol } = meta
  const base = colSqlOrThrow(ctx, field)

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
    // Equal-width bucketing over the column's full range — bin edges come from
    // the whole table via scalar subqueries (stable regardless of the card's
    // filter), and width_bucket assigns each row to bucket 1..numBins. `+ 1` on
    // the upper bound pulls the max value into the last bucket instead of an
    // overflow bucket. numBins is a validated int; the table + column are
    // whitelist-derived, so nothing untrusted reaches SQL.
    if (field.includes('.')) {
      throw new Error('Numeric binning is only supported on a direct column, not a joined field')
    }
    const lo = sql.join(
      [sql.raw('(SELECT MIN('), base, sql.raw(`) FROM "${ctx.entity.table}")`)],
      sql.raw(''),
    )
    const hi = sql.join(
      [sql.raw('(SELECT MAX('), base, sql.raw(`) FROM "${ctx.entity.table}")`)],
      sql.raw(''),
    )
    const bucket = sql.join(
      [
        sql.raw('width_bucket('),
        base,
        sql.raw(', '),
        lo,
        sql.raw(', ('),
        hi,
        sql.raw(`) + 1, ${b.bin.numBins})`),
      ],
      sql.raw(''),
    )
    return {
      select: aliased(bucket, b.alias),
      column: {
        key: b.alias,
        label: aCol?.label ?? col.label,
        role: 'dimension',
        semanticType: 'dimension',
        dataType: 'number',
        bin: b.bin,
      },
    }
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

// --- Cross-source metrics ---------------------------------------------------
// A stage may carry `joinedSources`: additional entities, each aggregated to the
// primary stage's grain and FULL OUTER JOINed on the shared breakout dimensions.
// This makes a metric whose parts live in DIFFERENT tables — e.g. TRIR =
// recordable incidents ÷ hours worked × 200000 — buildable with NO database view.
// Each source becomes an aggregated subquery; the outer SELECT references those
// subqueries' columns directly, so top-level calc measures combine across them.

/** Compile one source to an aggregated subquery (`SELECT <grain>, <measures> …
 *  GROUP BY <grain>`), returning the statement (unparenthesised) and its output
 *  columns. Reuses the same whitelist-safe helpers as the single-source path. */
/** AND an entity's implicit base filter (a scoped virtual entity, e.g. a per-app
 *  `form_responses:<templateId>` source) into the stage WHERE, so the scope binds
 *  on every query against that entity. The stage predicate is parenthesised to
 *  preserve its own OR grouping; the base filter's value binds as a param. */
function withBaseFilter(
  entity: AnalyticsEntity,
  ctx: CompileCtx,
  stageWhere: SQL | null,
): SQL | null {
  if (!entity.baseFilter) return stageWhere
  const baseWhere = compileRuleGroup(entity, entity.baseFilter, (c) => colSqlOf(ctx, c))
  if (!baseWhere) return stageWhere
  if (!stageWhere) return baseWhere
  return sql.join([baseWhere, sql.raw(' AND ('), stageWhere, sql.raw(')')], sql.raw(''))
}

function compileAggregatedSubquery(
  source: string,
  filter: ReportRuleGroup | null | undefined,
  breakouts: BhqlBreakout[],
  baseMeasures: BhqlMeasure[],
  exprMeasures: BhqlExprMeasure[],
  entityMap: Record<string, AnalyticsEntity>,
): { sql: SQL; columns: ResultColumn[] } {
  const aEntity = entityMap[source]
  if (!aEntity) throw new Error(`Unknown source entity "${source}"`)
  const entity: ReportEntity = aEntity
  const joins = new Map<string, JoinSpec>()
  const ctx: CompileCtx = { entity, aEntity, entityMap, joins, unnests: [] }

  const selects: SQL[] = []
  const columns: ResultColumn[] = []
  for (const b of breakouts) {
    const { select, column } = breakoutColumn(ctx, b)
    selects.push(select)
    columns.push(column)
  }
  for (const m of baseMeasures) {
    const { expr, column } = baseMeasureExpr(ctx, m)
    selects.push(aliased(expr, m.alias))
    columns.push(column)
  }
  for (const m of exprMeasures) {
    selects.push(aliased(compileExpr(ctx, m.expr), m.alias))
    columns.push({
      key: m.alias,
      label: humanizeAlias(m.alias),
      role: 'measure',
      semanticType: 'measure',
      dataType: 'number',
    })
  }
  if (selects.length === 0) throw new Error(`Source "${source}" selects no columns`)

  const where = withBaseFilter(
    aEntity,
    ctx,
    filter ? compileRuleGroup(entity, filter, (c) => colSqlOf(ctx, c)) : null,
  )
  const whereSql = where ? sql.join([sql.raw('WHERE '), where], sql.raw('')) : null
  const groupBy = breakouts.length
    ? sql.raw(`GROUP BY ${breakouts.map((_, i) => i + 1).join(', ')}`)
    : null
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
    ...ctx.unnests.map((u) => u.sql),
    whereSql,
    groupBy,
  ]
  return {
    sql: sql.join(
      parts.filter((p): p is SQL => p != null),
      sql.raw(' '),
    ),
    columns,
  }
}

/** Compile a cross-source stage: primary + joined aggregated subqueries, FULL
 *  OUTER JOINed (null-safe) on the shared grain — or CROSS JOINed when there's
 *  no grain (a single scalar metric like an org-wide TRIR). Top-level calc
 *  measures reference the subqueries' columns directly (no inlining needed). */
function compileMultiSource(
  query: BhqlQuery,
  opts: { maxRows?: number; entityMap: Record<string, AnalyticsEntity> },
): CompiledBhql {
  const stage = query.stages[0]!
  const { entityMap } = opts
  const breakouts = stage.breakouts ?? []
  const allMeasures = stage.aggregations ?? []
  const primaryBase = allMeasures.filter(
    (m): m is BhqlMeasure => m.kind === undefined || m.kind === 'agg',
  )
  const calcMeasures = allMeasures.filter((m): m is BhqlCalcMeasure => m.kind === 'calc')
  const exprMeasures = allMeasures.filter((m): m is BhqlExprMeasure => m.kind === 'expr')
  const joinedSources = stage.joinedSources ?? []

  const primary = compileAggregatedSubquery(
    stage.source,
    stage.filter,
    breakouts,
    primaryBase,
    exprMeasures,
    entityMap,
  )
  const joined = joinedSources.map((js, i) => {
    const grainBreakouts: BhqlBreakout[] = js.on.map((k) => ({
      field: k.field,
      alias: k.breakout,
      bin: k.bin,
    }))
    return {
      alias: `s${i}`,
      sub: compileAggregatedSubquery(
        js.source,
        js.filter,
        grainBreakouts,
        js.measures,
        [],
        entityMap,
      ),
      measures: js.measures,
    }
  })

  const grainCols = breakouts.map((b) => b.alias)
  // Joined first, primary last → the primary's grain-column metadata wins
  // (measure aliases are globally unique, so they never collide).
  const subColByAlias = new Map<string, ResultColumn>()
  joined.forEach((j) => j.sub.columns.forEach((c) => subColByAlias.set(c.key, c)))
  primary.columns.forEach((c) => subColByAlias.set(c.key, c))

  const selects: SQL[] = []
  const columns: ResultColumn[] = []

  // Grain columns — COALESCE across every subquery that carries them (full grain
  // alignment is enforced by the validator, so each source carries each dim).
  for (const g of grainCols) {
    const carriers: SQL[] = [sql.raw(`p."${g}"`)]
    joined.forEach((j, i) => {
      if (joinedSources[i]!.on.some((k) => k.breakout === g))
        carriers.push(sql.raw(`${j.alias}."${g}"`))
    })
    const ref = carriers.length > 1 ? fnCall('COALESCE', carriers) : carriers[0]!
    selects.push(aliased(ref, g))
    columns.push(
      subColByAlias.get(g) ?? {
        key: g,
        label: humanizeAlias(g),
        role: 'dimension',
        semanticType: 'dimension',
        dataType: 'string',
      },
    )
  }

  // Measure columns — referenced straight off their subquery alias.
  const exprMap = new Map<string, SQL>()
  const pushMeasure = (alias: string, ref: SQL) => {
    exprMap.set(alias, ref)
    selects.push(aliased(ref, alias))
    columns.push(
      subColByAlias.get(alias) ?? {
        key: alias,
        label: humanizeAlias(alias),
        role: 'measure',
        semanticType: 'measure',
        dataType: 'number',
      },
    )
  }
  for (const m of primaryBase) pushMeasure(m.alias, sql.raw(`p."${m.alias}"`))
  for (const m of exprMeasures) pushMeasure(m.alias, sql.raw(`p."${m.alias}"`))
  joined.forEach((j) => {
    for (const m of j.measures) pushMeasure(m.alias, sql.raw(`${j.alias}."${m.alias}"`))
  })
  for (const m of calcMeasures) {
    const { select, column } = calcMeasureColumn(m, exprMap)
    selects.push(select)
    columns.push(column)
  }

  // FROM ( primary ) p [FULL OUTER JOIN ( s_i ) s_i ON <null-safe grain>] — the
  // ON COALESCEs all prior carriers so a 3+ source full-outer chain stays correct.
  const priorCarriers: Record<string, SQL[]> = {}
  for (const g of grainCols) priorCarriers[g] = [sql.raw(`p."${g}"`)]
  let from: SQL = sql.join([sql.raw('FROM'), paren(primary.sql), sql.raw('p')], sql.raw(' '))
  joined.forEach((j) => {
    if (grainCols.length === 0) {
      from = sql.join(
        [from, sql.raw('CROSS JOIN'), paren(j.sub.sql), sql.raw(j.alias)],
        sql.raw(' '),
      )
      return
    }
    const onParts = grainCols.map((g) => {
      const prior = priorCarriers[g]!
      const left = prior.length > 1 ? fnCall('COALESCE', prior) : prior[0]!
      return sql.join([left, sql.raw(` IS NOT DISTINCT FROM ${j.alias}."${g}"`)], sql.raw(''))
    })
    from = sql.join(
      [
        from,
        sql.raw('FULL OUTER JOIN'),
        paren(j.sub.sql),
        sql.raw(`${j.alias} ON`),
        sql.join(onParts, sql.raw(' AND ')),
      ],
      sql.raw(' '),
    )
    for (const g of grainCols) priorCarriers[g]!.push(sql.raw(`${j.alias}."${g}"`))
  })

  if (selects.length === 0) throw new Error('Query selects no columns')

  const requested = typeof stage.limit === 'number' ? stage.limit : DEFAULT_LIMIT
  let effectiveLimit = Math.min(Math.max(Math.trunc(requested), 1), HARD_MAX)
  if (opts.maxRows) effectiveLimit = Math.min(effectiveLimit, opts.maxRows)

  const ordinalOf = new Map<string, number>()
  columns.forEach((c, i) => ordinalOf.set(c.key, i + 1))
  const orderParts: string[] = []
  for (const o of stage.orderBy ?? []) {
    const ord = ordinalOf.get(o.ref)
    if (ord) orderParts.push(`${ord} ${o.direction === 'asc' ? 'ASC' : 'DESC'}`)
  }
  if (orderParts.length === 0 && grainCols.length) orderParts.push('1 ASC')
  const orderBy = orderParts.length ? sql.raw(`ORDER BY ${orderParts.join(', ')}`) : null

  const parts: (SQL | null)[] = [
    sql.raw('SELECT'),
    sql.join(selects, sql.raw(', ')),
    from,
    orderBy,
    sql.raw(`LIMIT ${effectiveLimit}`),
  ]
  return {
    sql: sql.join(
      parts.filter((p): p is SQL => p != null),
      sql.raw(' '),
    ),
    columns,
    effectiveLimit,
  }
}

// --- Spine (coverage matrix) ------------------------------------------------
// A stage may carry a `spine`: a cross-product of dimension sources (people ×
// courses) plus latest-fact LATERAL joins (the most recent training record per
// pair), addressed by "<alias>.<column>". This rebuilds a coverage matrix —
// e.g. the training matrix and its missing/expired/expiring/valid status — over
// raw tables with NO database view. The breakouts/measures/expressions reuse the
// single-source helpers via a resolver injected on the ctx.

function compileSpine(
  query: BhqlQuery,
  opts: { maxRows?: number; entityMap: Record<string, AnalyticsEntity> },
): CompiledBhql {
  const stage = query.stages[0]!
  const { entityMap } = opts
  const spine = stage.spine!

  const sources = new Map<string, { entity: ReportEntity; aEntity: AnalyticsEntity }>()
  const register = (alias: string, source: string) => {
    const ae = entityMap[source]
    if (!ae) throw new Error(`Unknown source entity "${source}"`)
    sources.set(alias, { entity: ae, aEntity: ae })
  }
  for (const d of spine.dimensions) register(d.alias, d.source)
  for (const f of spine.facts ?? []) register(f.alias, f.source)

  const joins = new Map<string, JoinSpec>()
  // Resolve "<alias>.<col>" against a spine source, or "<alias>.<via>.<col>" by
  // following FK relations from that source (registering LEFT JOINs).
  const resolve = (ref: string): SQL | null => {
    const segs = ref.split('.')
    const src = sources.get(segs[0]!)
    if (!src) return null
    if (segs.length === 2) {
      const col = entityColumnSql(src.entity, segs[1]!)
      return col ? sql.raw(`"${segs[0]}"."${col}"`) : null
    }
    let curEntity: AnalyticsEntity = src.aEntity
    let curAlias = segs[0]!
    let pathKey = segs[0]!
    for (let i = 1; i < segs.length - 1; i++) {
      const via = segs[i]!
      const rel = (curEntity.relations ?? []).find((r) => r.via === via)
      if (!rel) return null
      const target = entityMap[rel.target]
      if (!target) return null
      const localCol = entityColumnSql(curEntity, via)
      if (!localCol) return null
      pathKey = `${pathKey}.${via}`
      const alias = `j_${pathKey.replace(/\./g, '__')}`
      if (!joins.has(pathKey)) {
        joins.set(pathKey, {
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
  const resolveMeta = (ref: string) => {
    const segs = ref.split('.')
    const src = sources.get(segs[0]!)
    if (!src) return null
    let curEntity: AnalyticsEntity = src.aEntity
    for (let i = 1; i < segs.length - 1; i++) {
      const rel = (curEntity.relations ?? []).find((r) => r.via === segs[i])
      if (!rel) return null
      const target = entityMap[rel.target]
      if (!target) return null
      curEntity = target
    }
    const key = segs[segs.length - 1]!
    const col = entityColumn(curEntity, key)
    return col ? { col, aCol: analyticsColumn(curEntity, key) } : null
  }

  const base = sources.get(spine.dimensions[0]!.alias)!
  const ctx: CompileCtx = {
    entity: base.entity,
    aEntity: base.aEntity,
    entityMap,
    joins,
    resolve,
    resolveMeta,
    unnests: [],
  }

  const breakouts = stage.breakouts ?? []
  const allMeasures = stage.aggregations ?? []
  const baseMeasures = allMeasures.filter(
    (m): m is BhqlMeasure => m.kind === undefined || m.kind === 'agg',
  )
  const calcMeasures = allMeasures.filter((m): m is BhqlCalcMeasure => m.kind === 'calc')
  const exprMeasures = allMeasures.filter((m): m is BhqlExprMeasure => m.kind === 'expr')

  const selects: SQL[] = []
  const columns: ResultColumn[] = []
  for (const b of breakouts) {
    const { select, column } = breakoutColumn(ctx, b)
    selects.push(select)
    columns.push(column)
  }
  const exprMap = new Map<string, SQL>()
  for (const m of baseMeasures) {
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
  for (const m of exprMeasures) {
    selects.push(aliased(compileExpr(ctx, m.expr), m.alias))
    columns.push({
      key: m.alias,
      label: humanizeAlias(m.alias),
      role: 'measure',
      semanticType: 'measure',
      dataType: 'string',
    })
  }
  if (selects.length === 0) throw new Error('Query selects no columns')

  // WHERE — each dimension's filter resolves against its OWN entity/alias.
  const whereConds: SQL[] = []
  for (const d of spine.dimensions) {
    if (!d.filter) continue
    const dEntity = sources.get(d.alias)!.entity
    const sub = compileRuleGroup(dEntity, d.filter, (ref) => {
      const col = entityColumnSql(dEntity, ref)
      return col ? sql.raw(`"${d.alias}"."${col}"`) : null
    })
    if (sub) whereConds.push(sub)
  }
  const whereSql = whereConds.length
    ? sql.join([sql.raw('WHERE '), sql.join(whereConds, sql.raw(' AND '))], sql.raw(''))
    : null

  // FROM: dimension cross-product + latest-fact LATERAL joins.
  const dims = spine.dimensions
  let from: SQL = sql.raw(`FROM "${sources.get(dims[0]!.alias)!.entity.table}" "${dims[0]!.alias}"`)
  for (let i = 1; i < dims.length; i++) {
    const d = dims[i]!
    from = sql.join(
      [from, sql.raw(`CROSS JOIN "${sources.get(d.alias)!.entity.table}" "${d.alias}"`)],
      sql.raw(' '),
    )
  }
  for (const f of spine.facts ?? []) {
    const fEntity = sources.get(f.alias)!.entity
    const innerAlias = `${f.alias}_src`
    const onParts: SQL[] = f.on.map((o) => {
      const factCol = entityColumnSql(fEntity, o.field)
      if (!factCol) throw new Error(`Unknown field "${o.field}" on ${f.source}`)
      const outer = resolve(o.equals)
      if (!outer) throw new Error(`Unknown spine ref "${o.equals}"`)
      return sql.join([sql.raw(`"${innerAlias}"."${factCol}" = `), outer], sql.raw(''))
    })
    const fWhere = f.filter
      ? compileRuleGroup(fEntity, f.filter, (ref) => {
          const col = entityColumnSql(fEntity, ref)
          return col ? sql.raw(`"${innerAlias}"."${col}"`) : null
        })
      : null
    const innerConds = fWhere ? [...onParts, fWhere] : onParts
    let orderLimit: SQL | null = null
    if (f.latestBy?.length) {
      const ob = f.latestBy.map((o) => {
        const col = entityColumnSql(fEntity, o.ref)
        if (!col) throw new Error(`Unknown order field "${o.ref}" on ${f.source}`)
        return `"${innerAlias}"."${col}" ${o.direction === 'asc' ? 'ASC' : 'DESC'}`
      })
      orderLimit = sql.raw(`ORDER BY ${ob.join(', ')} LIMIT 1`)
    }
    const lateralParts: (SQL | null)[] = [
      sql.raw(`SELECT "${innerAlias}".* FROM "${fEntity.table}" "${innerAlias}" WHERE`),
      sql.join(innerConds, sql.raw(' AND ')),
      orderLimit,
    ]
    const lateral = sql.join(
      lateralParts.filter((p): p is SQL => p != null),
      sql.raw(' '),
    )
    from = sql.join(
      [from, sql.raw('LEFT JOIN LATERAL ('), lateral, sql.raw(`) "${f.alias}" ON true`)],
      sql.raw(' '),
    )
  }
  const joinClauses = [...joins.values()].map((j) =>
    sql.raw(
      `LEFT JOIN "${j.table}" "${j.alias}" ON "${j.leftAlias}"."${j.localCol}" = "${j.alias}"."${j.foreignCol}"`,
    ),
  )

  const isAggregate = allMeasures.length > 0 || breakouts.length > 0
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

  const requested = typeof stage.limit === 'number' ? stage.limit : DEFAULT_LIMIT
  let effectiveLimit = Math.min(Math.max(Math.trunc(requested), 1), HARD_MAX)
  if (opts.maxRows) effectiveLimit = Math.min(effectiveLimit, opts.maxRows)

  const parts: (SQL | null)[] = [
    sql.raw('SELECT'),
    sql.join(selects, sql.raw(', ')),
    from,
    ...joinClauses,
    ...ctx.unnests.map((u) => u.sql),
    whereSql,
    groupBy,
    orderBy,
    sql.raw(`LIMIT ${effectiveLimit}`),
  ]
  return {
    sql: sql.join(
      parts.filter((p): p is SQL => p != null),
      sql.raw(' '),
    ),
    columns,
    effectiveLimit,
  }
}

export function compileBhql(
  query: BhqlQuery,
  opts: { maxRows?: number; entityMap?: Record<string, AnalyticsEntity> } = {},
): CompiledBhql {
  const stage = query.stages[0]
  if (!stage) throw new Error('Query has no stage')
  const entityMap = opts.entityMap ?? discoverEntityMap()
  // Spine query: dimension cross-product + latest-fact LATERAL joins (coverage
  // matrices) — the view-free form of the training matrix.
  if (stage.spine) {
    return compileSpine(query, { entityMap, maxRows: opts.maxRows })
  }
  // Cross-source metric query: aggregate each source independently to the shared
  // grain, then FULL OUTER JOIN — keeps cross-table ratios view-free.
  if (stage.joinedSources && stage.joinedSources.length > 0) {
    return compileMultiSource(query, { entityMap, maxRows: opts.maxRows })
  }
  const aEntity = entityMap[stage.source]
  if (!aEntity) throw new Error(`Unknown source entity "${stage.source}"`)
  // The discovered AnalyticsEntity carries both the report columns (table/sql) and
  // the semantic metadata, so it serves as both `entity` and `aEntity`.
  const entity: ReportEntity = aEntity

  // Foreign-key joins are discovered lazily while resolving field refs (colSqlOf)
  // across breakouts, measures and filters, then emitted as LEFT JOINs below.
  const joins = new Map<string, JoinSpec>()
  const ctx: CompileCtx = { entity, aEntity, entityMap, joins, unnests: [] }

  const breakouts = stage.breakouts ?? []
  const allMeasures = stage.aggregations ?? []
  const baseMeasures = allMeasures.filter(
    (m): m is BhqlMeasure => m.kind === undefined || m.kind === 'agg',
  )
  const calcMeasures = allMeasures.filter((m): m is BhqlCalcMeasure => m.kind === 'calc')
  const exprMeasures = allMeasures.filter((m): m is BhqlExprMeasure => m.kind === 'expr')
  const rawColumns = stage.columns ?? []
  const isAggregate = allMeasures.length > 0 || breakouts.length > 0

  const requested = typeof stage.limit === 'number' ? stage.limit : DEFAULT_LIMIT
  let effectiveLimit = Math.min(Math.max(Math.trunc(requested), 1), HARD_MAX)
  if (opts.maxRows) effectiveLimit = Math.min(effectiveLimit, opts.maxRows)

  const where = withBaseFilter(
    aEntity,
    ctx,
    stage.filter ? compileRuleGroup(entity, stage.filter, (c) => colSqlOf(ctx, c)) : null,
  )
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
    if (bases.length === 0 && calcMeasures.length === 0 && exprMeasures.length === 0) {
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
    // Custom-aggregation measures — an arbitrary expression (may contain agg
    // nodes), e.g. datediff('day', max(occurred_at), now()) for "days since".
    for (const m of exprMeasures) {
      selects.push(aliased(compileExpr(ctx, m.expr), m.alias))
      columns.push({
        key: m.alias,
        label: humanizeAlias(m.alias),
        role: 'measure',
        semanticType: 'measure',
        dataType: 'number',
      })
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
    ...ctx.unnests.map((u) => u.sql),
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
