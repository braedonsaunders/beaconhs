// The single validation authority for BHQL. Turns untrusted jsonb / AI output
// into a typed, registry-safe `BhqlQuery`, or throws a user-facing
// `BhqlValidationError`. Runs at every server-action boundary (preview / create /
// update) and the future natural-language → query path.
//
// Pure + runtime-free: depends only on zod and the report entity registry
// (@beaconhs/reports/entities, no drizzle), so it is safe in client bundles.
// Every BHQL identifier is checked against the whitelist here; the compiler then
// re-derives identifiers through the same whitelist, so neither layer ever
// trusts a caller-supplied physical column name.

import { z } from 'zod'
import {
  REPORT_OPERATORS,
  entityColumn,
  type ReportEntity,
  type ReportEntityColumn,
} from '@beaconhs/reports/entities'
import type { BhqlMeasure, BhqlQuery, BhqlStage } from '@beaconhs/db/schema'

export class BhqlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BhqlValidationError'
  }
}

const MAX_LIMIT = 50_000
const MAX_TREE_DEPTH = 5
const MAX_TREE_RULES = 60
const ALIAS_RE = /^[a-z][a-z0-9_]{0,40}$/

const OP_SET = new Set<string>(REPORT_OPERATORS.map((o) => o.key))

// ---- structural schema (shape only; semantics validated below) -------------

const zRule = z.object({
  field: z.string(),
  op: z.string(),
  value: z.unknown().optional(),
})

const zRuleGroup: z.ZodType = z.lazy(() =>
  z.object({
    combinator: z.enum(['and', 'or']),
    not: z.boolean().optional(),
    rules: z.array(z.union([zRule, zRuleGroup])),
  }),
)

const zBin = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('temporal'),
    unit: z.enum(['day', 'week', 'month', 'quarter', 'year']),
  }),
  z.object({ kind: z.literal('numeric'), numBins: z.number().int().min(2).max(50) }),
])

const zAggFn = z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max'])

/** Custom expression (recursive). Structural only; the semantic check below
 *  whitelists functions/units and resolves every field. */
const zExpr: z.ZodType = z.lazy(() =>
  z.union([
    z.object({ ex: z.literal('field'), field: z.string() }),
    z.object({
      ex: z.literal('lit'),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
    z.object({
      ex: z.literal('arith'),
      op: z.enum(['+', '-', '*', '/']),
      left: zExpr,
      right: zExpr,
    }),
    z.object({
      ex: z.literal('compare'),
      op: z.enum(['=', '!=', '<', '<=', '>', '>=']),
      left: zExpr,
      right: zExpr,
    }),
    z.object({ ex: z.literal('isnull'), arg: zExpr, negated: z.boolean().optional() }),
    z.object({ ex: z.literal('logic'), op: z.enum(['and', 'or', 'not']), args: z.array(zExpr) }),
    z.object({
      ex: z.literal('case'),
      branches: z.array(z.object({ when: zExpr, then: zExpr })),
      else: zExpr.optional(),
    }),
    z.object({ ex: z.literal('call'), fn: z.string(), args: z.array(zExpr) }),
    z.object({
      ex: z.literal('agg'),
      fn: zAggFn,
      arg: zExpr.optional(),
      filter: zRuleGroup.nullish(),
    }),
  ]),
)

const zMeasure = z.object({
  kind: z.literal('agg').optional(),
  fn: zAggFn,
  field: z.string().optional(),
  alias: z.string(),
  filter: zRuleGroup.nullish(),
})

const zCalcMeasure = z.object({
  kind: z.literal('calc'),
  alias: z.string(),
  numerator: z.string(),
  denominator: z.string().optional(),
  multiplier: z.number().optional(),
})

const zExprMeasure = z.object({ kind: z.literal('expr'), alias: z.string(), expr: zExpr })

const zAnyMeasure = z.union([zMeasure, zCalcMeasure, zExprMeasure])

const zBreakout = z.object({
  field: z.string().optional(),
  expr: zExpr.optional(),
  alias: z.string(),
  bin: zBin.optional(),
  unnest: z.enum(['array', 'jsonb']).optional(),
})

const zPivot = z.object({
  rows: z.array(z.object({ breakout: z.string() })).min(1),
  columns: z.array(z.object({ breakout: z.string() })).min(1),
  values: z.array(z.object({ measure: z.string() })).min(1),
  subtotals: z.enum(['none', 'rows', 'both']).optional(),
})

const zJoinKey = z.object({
  breakout: z.string(),
  field: z.string(),
  bin: zBin.optional(),
})

const zJoinedSource = z.object({
  source: z.string(),
  filter: zRuleGroup.nullish(),
  measures: z.array(zMeasure),
  on: z.array(zJoinKey),
})

const zMetricRef = z.object({
  metricId: z.string(),
  alias: z.string(),
  on: z.array(zJoinKey),
})

const zSpineSource = z.object({
  alias: z.string(),
  source: z.string(),
  filter: zRuleGroup.nullish(),
})

const zSpineFact = z.object({
  alias: z.string(),
  source: z.string(),
  filter: zRuleGroup.nullish(),
  on: z.array(z.object({ field: z.string(), equals: z.string() })),
  latestBy: z.array(z.object({ ref: z.string(), direction: z.enum(['asc', 'desc']) })).optional(),
})

const zSpine = z.object({
  dimensions: z.array(zSpineSource).min(1),
  facts: z.array(zSpineFact).optional(),
})

const zStage = z.object({
  source: z.string(),
  filter: zRuleGroup.nullish(),
  aggregations: z.array(zAnyMeasure).optional(),
  breakouts: z.array(zBreakout).optional(),
  joinedSources: z.array(zJoinedSource).optional(),
  metricRefs: z.array(zMetricRef).optional(),
  spine: zSpine.optional(),
  columns: z.array(z.string()).optional(),
  orderBy: z.array(z.object({ ref: z.string(), direction: z.enum(['asc', 'desc']) })).optional(),
  limit: z.number().nullish(),
})

const zQuery = z.object({
  version: z.literal('bhql/1'),
  stages: z.array(zStage),
  display: z.enum(['table', 'pivot']),
  pivot: zPivot.nullish(),
})

type ParsedQuery = z.infer<typeof zQuery>
type ParsedStage = z.infer<typeof zStage>

// ---- semantic validation (registry-aware) ----------------------------------

function fail(message: string): never {
  throw new BhqlValidationError(message)
}

/** Entities discovered with FK relations (the runtime shape of the entity map). */
type EntityWithRelations = ReportEntity & {
  relations?: { via: string; target: string; foreignColumn: string }[]
}

/** Resolve a field ref to its column. A ref shaped "<via>.<column>" follows the
 *  foreign-key relation `<via>` to `<column>` on the related entity; relations
 *  only ever target RLS-safe entities (see discover.ts), so this can never
 *  resolve into a non-tenant-isolated table. Returns null when unresolvable. */
function resolveField(
  entity: ReportEntity,
  entityMap: Record<string, ReportEntity>,
  ref: string,
): ReportEntityColumn | null {
  const segs = ref.split('.')
  if (segs.length === 1) return entityColumn(entity, ref)
  let cur: ReportEntity = entity
  for (let i = 0; i < segs.length - 1; i++) {
    const rel = (cur as EntityWithRelations).relations?.find((r) => r.via === segs[i])
    if (!rel) return null
    const next = entityMap[rel.target]
    if (!next) return null
    cur = next
  }
  return entityColumn(cur, segs[segs.length - 1]!)
}

function checkAlias(alias: string, what: string): void {
  if (!ALIAS_RE.test(alias)) fail(`Invalid ${what} alias "${alias}" (use lower_snake_case)`)
}

/** Guard against hand-crafted/AI filter trees: enforce depth + total rule caps. */
function validateFilterDepth(group: unknown): void {
  let count = 0
  const walk = (g: unknown, depth: number): void => {
    if (depth > MAX_TREE_DEPTH) fail('Filter is nested too deeply')
    const rules = (g as { rules?: unknown[] }).rules ?? []
    for (const r of rules) {
      if (++count > MAX_TREE_RULES) fail('Filter has too many rules')
      if (r && typeof r === 'object' && Array.isArray((r as { rules?: unknown }).rules)) {
        walk(r, depth + 1)
      } else if (r && typeof r === 'object') {
        const op = (r as { op?: unknown }).op
        if (typeof op === 'string' && !OP_SET.has(op)) fail(`Unknown filter operator "${op}"`)
      }
    }
  }
  walk(group, 1)
}

function validateMeasure(
  entity: ReportEntity,
  entityMap: Record<string, ReportEntity>,
  m: BhqlMeasure,
): void {
  if (m.fn === 'count') {
    if (m.field) fail('count takes no field')
    return
  }
  if (!m.field) fail(`${m.fn} requires a field`)
  const col = resolveField(entity, entityMap, m.field)
  if (!col) fail(`Unknown field "${m.field}" on ${entity.key}`)
  if ((m.fn === 'sum' || m.fn === 'avg') && col.kind !== 'number') {
    fail(`${m.fn} requires a numeric field (got "${m.field}")`)
  }
  // min/max work on any orderable column (text/enum/date/number). Allowing them
  // on a categorical column lets a pivot surface a single per-cell status string
  // (e.g. the training-matrix coverage), since min() of one value is that value.
}

const EXPR_FNS = new Set([
  'now',
  'current_date',
  'coalesce',
  'nullif',
  'abs',
  'round',
  'ceil',
  'floor',
  'power',
  'sqrt',
  'lower',
  'upper',
  'length',
  'trim',
  'concat',
  'datediff',
  'datetrunc',
  'datepart',
])
const EXPR_UNITS = new Set(['day', 'week', 'month', 'quarter', 'year', 'hour', 'minute'])
const EXPR_PARTS = new Set([
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

/** Semantic check for a custom expression: every function + unit is whitelisted,
 *  every field resolves, aggregates aren't nested or used where disallowed, and
 *  the tree isn't pathologically deep. */
function validateExpr(
  entity: ReportEntity,
  entityMap: Record<string, ReportEntity>,
  e: unknown,
  opts: {
    depth?: number
    insideAgg?: boolean
    allowAgg?: boolean
    /** Spine mode: resolve "<alias>.<col>" refs against the spine's sources. */
    resolve?: (ref: string) => ReportEntityColumn | null
  },
): void {
  const depth = opts.depth ?? 0
  const insideAgg = opts.insideAgg ?? false
  const allowAgg = opts.allowAgg ?? true
  if (depth > 12) fail('Expression is nested too deeply')
  const x = e as { ex: string; [k: string]: unknown }
  const recurse = (sub: unknown, o?: { insideAgg?: boolean; allowAgg?: boolean }) =>
    validateExpr(entity, entityMap, sub, {
      depth: depth + 1,
      insideAgg: o?.insideAgg ?? insideAgg,
      allowAgg: o?.allowAgg ?? allowAgg,
      resolve: opts.resolve,
    })
  const resolveOne = (ref: string) =>
    opts.resolve ? opts.resolve(ref) : resolveField(entity, entityMap, ref)
  switch (x.ex) {
    case 'field':
      if (!resolveOne(x.field as string)) fail(`Unknown field "${x.field}" in expression`)
      return
    case 'isnull':
      recurse(x.arg)
      return
    case 'lit':
      return
    case 'arith':
    case 'compare':
      recurse(x.left)
      recurse(x.right)
      return
    case 'logic':
      for (const a of (x.args as unknown[]) ?? []) recurse(a)
      return
    case 'case':
      for (const b of (x.branches as { when: unknown; then: unknown }[]) ?? []) {
        recurse(b.when)
        recurse(b.then)
      }
      if (x.else !== undefined) recurse(x.else)
      return
    case 'call': {
      const fn = x.fn as string
      if (!EXPR_FNS.has(fn)) fail(`Unknown function "${fn}"`)
      const args = (x.args as { ex?: string; value?: unknown }[]) ?? []
      if (fn === 'datediff' || fn === 'datetrunc') {
        const u = args[0]
        if (!(u && u.ex === 'lit' && typeof u.value === 'string' && EXPR_UNITS.has(u.value)))
          fail(`"${fn}" needs a unit literal (day, week, month, quarter, year, hour, minute)`)
      }
      if (fn === 'datepart') {
        const p = args[0]
        if (!(p && p.ex === 'lit' && typeof p.value === 'string' && EXPR_PARTS.has(p.value)))
          fail('datepart needs a part literal (dow, day, month, quarter, year, …)')
      }
      for (const a of args) recurse(a)
      return
    }
    case 'agg':
      if (!allowAgg) fail('An aggregate is not allowed here — use a plain (row-level) expression')
      if (insideAgg) fail('Cannot nest an aggregate inside another aggregate')
      if (x.fn !== 'count' && !x.arg) fail(`${String(x.fn)} needs an argument`)
      if (x.arg) recurse(x.arg, { insideAgg: true, allowAgg: false })
      if (x.filter) validateFilterDepth(x.filter)
      return
    default:
      fail('Invalid expression')
  }
}

/** Validate a spine stage (dimension cross-product + latest-fact joins). Fields
 *  are addressed "<alias>.<column>" and resolved against the spine's OWN sources
 *  — never a single base entity — so a coverage matrix (the training matrix) is
 *  buildable with no database view. Returns the normalized query. */
function parseSpine(
  q: ParsedQuery,
  stage: ParsedStage,
  entityMap: Record<string, ReportEntity>,
): BhqlQuery {
  const spine = stage.spine!
  if (spine.dimensions.length < 1) fail('A spine needs at least one dimension')

  const sources = new Map<string, EntityWithRelations>()
  for (const s of [...spine.dimensions, ...(spine.facts ?? [])]) {
    checkAlias(s.alias, 'source')
    if (sources.has(s.alias)) fail(`Duplicate spine alias "${s.alias}"`)
    const e = entityMap[s.source]
    if (!e) fail(`Unknown source entity "${s.source}"`)
    sources.set(s.alias, e as EntityWithRelations)
  }

  // Resolve "<alias>.<col>" (or "<alias>.<fk>.<col>") against the spine sources.
  const resolveSpine = (ref: string): ReportEntityColumn | null => {
    const segs = ref.split('.')
    const src = sources.get(segs[0]!)
    if (!src) return null
    if (segs.length === 2) return entityColumn(src, segs[1]!)
    let cur: ReportEntity = src
    for (let i = 1; i < segs.length - 1; i++) {
      const rel = (cur as EntityWithRelations).relations?.find((r) => r.via === segs[i])
      if (!rel) return null
      const next = entityMap[rel.target]
      if (!next) return null
      cur = next
    }
    return entityColumn(cur, segs[segs.length - 1]!)
  }
  const placeholderEntity = sources.get(spine.dimensions[0]!.alias)!

  // Filters carry depth/op caps (field validity resolves at compile time, like
  // the single-source path). Fact correlations + ordering resolve now.
  for (const d of spine.dimensions) if (d.filter) validateFilterDepth(d.filter)
  for (const f of spine.facts ?? []) {
    const fEntity = sources.get(f.alias)!
    if (f.filter) validateFilterDepth(f.filter)
    if (f.on.length === 0) fail(`Fact "${f.source}" needs at least one join condition`)
    for (const o of f.on) {
      if (!entityColumn(fEntity, o.field)) fail(`Unknown field "${o.field}" on fact "${f.source}"`)
      if (!resolveSpine(o.equals)) fail(`A fact join references unknown spine field "${o.equals}"`)
    }
    for (const o of f.latestBy ?? []) {
      if (!entityColumn(fEntity, o.ref))
        fail(`Unknown order field "${o.ref}" on fact "${f.source}"`)
    }
  }

  const breakouts = stage.breakouts ?? []
  const measures = stage.aggregations ?? []
  const kindOf = (m: unknown) => (m as { kind?: string }).kind

  const aliases = new Set<string>()
  for (const b of breakouts) {
    checkAlias(b.alias, 'breakout')
    if (aliases.has(b.alias)) fail(`Duplicate alias "${b.alias}"`)
    aliases.add(b.alias)
    if (b.unnest && b.expr) fail(`Breakout "${b.alias}" can't both unnest and use an expression`)
    if (b.unnest && b.bin) fail(`Breakout "${b.alias}" can't both unnest and bin`)
    if (b.unnest && !b.field) fail(`Unnest breakout "${b.alias}" needs a field`)
    if (b.expr && b.field) fail(`Breakout "${b.alias}" can't have both a field and an expression`)
    if (b.expr) {
      validateExpr(placeholderEntity, entityMap, b.expr, { allowAgg: false, resolve: resolveSpine })
      continue
    }
    if (!b.field) fail(`Breakout "${b.alias}" needs a field or an expression`)
    const col = resolveSpine(b.field)
    if (!col) fail(`Unknown field "${b.field}" in spine`)
    if (b.bin?.kind === 'temporal' && !(col.kind === 'date' || col.kind === 'timestamp'))
      fail(`Field "${b.field}" can't be bucketed by time`)
    if (b.bin?.kind === 'numeric' && col.kind !== 'number')
      fail(`Field "${b.field}" can't be binned numerically`)
  }
  for (const m of measures) {
    checkAlias(m.alias, 'measure')
    if (aliases.has(m.alias)) fail(`Duplicate alias "${m.alias}"`)
    aliases.add(m.alias)
  }

  const baseMeasures = measures.filter((m) => kindOf(m) === undefined || kindOf(m) === 'agg')
  const exprMeasures = measures.filter((m) => kindOf(m) === 'expr')
  const calcMeasures = measures.filter((m) => kindOf(m) === 'calc')
  for (const m of baseMeasures) {
    const bm = m as BhqlMeasure
    if (bm.fn === 'count') {
      if (bm.field) fail('count takes no field')
    } else {
      if (!bm.field) fail(`${bm.fn} requires a field`)
      const col = resolveSpine(bm.field)
      if (!col) fail(`Unknown field "${bm.field}" in spine`)
      if ((bm.fn === 'sum' || bm.fn === 'avg') && col.kind !== 'number')
        fail(`${bm.fn} requires a numeric field (got "${bm.field}")`)
    }
    if (bm.filter) validateFilterDepth(bm.filter)
  }
  for (const m of exprMeasures) {
    validateExpr(placeholderEntity, entityMap, (m as { expr: unknown }).expr, {
      allowAgg: true,
      resolve: resolveSpine,
    })
  }
  const baseAliases = new Set(baseMeasures.map((m) => m.alias))
  for (const m of calcMeasures) {
    const cm = m as { numerator: string; denominator?: string }
    if (!baseAliases.has(cm.numerator))
      fail(`A calculated measure references unknown measure "${cm.numerator}"`)
    if (cm.denominator && !baseAliases.has(cm.denominator))
      fail(`A calculated measure references unknown measure "${cm.denominator}"`)
  }

  for (const o of stage.orderBy ?? []) {
    if (!aliases.has(o.ref)) fail(`order-by references unknown output "${o.ref}"`)
  }

  if (q.display === 'pivot' && q.pivot) {
    const bset = new Set(breakouts.map((b) => b.alias))
    const mset = new Set(measures.map((m) => m.alias))
    for (const r of q.pivot.rows)
      if (!bset.has(r.breakout)) fail(`pivot row "${r.breakout}" is not a breakout`)
    for (const c of q.pivot.columns)
      if (!bset.has(c.breakout)) fail(`pivot column "${c.breakout}" is not a breakout`)
    for (const v of q.pivot.values)
      if (!mset.has(v.measure)) fail(`pivot value "${v.measure}" is not a measure`)
  }

  const limit =
    typeof stage.limit === 'number' && Number.isFinite(stage.limit)
      ? Math.min(Math.max(Math.trunc(stage.limit), 1), MAX_LIMIT)
      : null

  return {
    version: 'bhql/1',
    display: q.display,
    pivot: q.pivot ?? null,
    stages: [{ ...stage, limit }],
  } as BhqlQuery
}

/** Parse + fully validate untrusted input into a typed BhqlQuery. Throws
 *  BhqlValidationError on any problem. */
export function parseBhqlQuery(raw: unknown, entityMap: Record<string, ReportEntity>): BhqlQuery {
  const parsed = zQuery.safeParse(raw)
  if (!parsed.success) {
    fail(parsed.error.issues[0]?.message ?? 'Malformed query')
  }
  const q = parsed.data

  if (q.stages.length !== 1) fail('Exactly one stage is supported')
  const stage = q.stages[0]!

  // A spine stage (dimension cross-product + latest-fact joins) addresses fields
  // by "<alias>.<column>" against its own sources, so it has a dedicated path.
  if (stage.spine) return parseSpine(q, stage, entityMap)

  const entity = entityMap[stage.source]
  if (!entity) fail(`Unknown source entity "${stage.source}"`)

  const measures = stage.aggregations ?? []
  const kindOf = (m: unknown) => (m as { kind?: string }).kind
  const baseMeasures = measures.filter((m) => kindOf(m) === undefined || kindOf(m) === 'agg')
  const calcMeasures = measures.filter((m) => kindOf(m) === 'calc')
  const exprMeasures = measures.filter((m) => kindOf(m) === 'expr')
  const breakouts = stage.breakouts ?? []
  const columns = stage.columns ?? []
  const joinedSources = stage.joinedSources ?? []

  // Aliases unique + slug-safe across breakouts ∪ measures.
  const aliases = new Set<string>()
  for (const b of breakouts) {
    checkAlias(b.alias, 'breakout')
    if (aliases.has(b.alias)) fail(`Duplicate alias "${b.alias}"`)
    aliases.add(b.alias)
  }
  for (const m of measures) {
    checkAlias(m.alias, 'measure')
    if (aliases.has(m.alias)) fail(`Duplicate alias "${m.alias}"`)
    aliases.add(m.alias)
  }

  // Cross-source metrics: each joined source is aggregated to the primary grain
  // and FULL OUTER JOINed. Validate its entity, its measures (resolved against
  // ITS own columns, aliases globally unique) and its grain mapping (every
  // primary breakout mapped exactly once to a real field on the joined source).
  const breakoutAliases = new Set(breakouts.map((b) => b.alias))
  for (const js of joinedSources) {
    const jsEntity = entityMap[js.source]
    if (!jsEntity) fail(`Unknown joined source "${js.source}"`)
    for (const m of js.measures) {
      checkAlias(m.alias, 'measure')
      if (aliases.has(m.alias)) fail(`Duplicate alias "${m.alias}"`)
      aliases.add(m.alias)
      validateMeasure(jsEntity, entityMap, m as BhqlMeasure)
      if ((m as BhqlMeasure).filter) validateFilterDepth((m as BhqlMeasure).filter)
    }
    const mapped = new Set<string>()
    for (const k of js.on) {
      if (!breakoutAliases.has(k.breakout))
        fail(`A joined source maps an unknown breakout "${k.breakout}"`)
      if (mapped.has(k.breakout)) fail(`Breakout "${k.breakout}" is mapped more than once`)
      mapped.add(k.breakout)
      const col = resolveField(jsEntity, entityMap, k.field)
      if (!col) fail(`Unknown field "${k.field}" on joined source "${js.source}"`)
      if (k.bin?.kind === 'temporal' && !(col.kind === 'date' || col.kind === 'timestamp'))
        fail(`Join field "${k.field}" can't be bucketed by time`)
      if (k.bin?.kind === 'numeric' && col.kind !== 'number')
        fail(`Join field "${k.field}" can't be binned numerically`)
    }
    if (mapped.size !== breakouts.length)
      fail(`Joined source "${js.source}" must map every breakout (the shared grain)`)
  }

  // Reusable Metric references — validate the alias + the grain mapping's breakout
  // side here; the metric's source/fields are validated at run time when the ref
  // is expanded into a joined source (the metric card isn't known until then).
  const metricRefs = stage.metricRefs ?? []
  for (const mr of metricRefs) {
    checkAlias(mr.alias, 'measure')
    if (aliases.has(mr.alias)) fail(`Duplicate alias "${mr.alias}"`)
    aliases.add(mr.alias)
    const mapped = new Set<string>()
    for (const k of mr.on) {
      if (!breakoutAliases.has(k.breakout))
        fail(`A metric reference maps an unknown breakout "${k.breakout}"`)
      mapped.add(k.breakout)
    }
    if (mapped.size !== breakouts.length)
      fail('A metric reference must map every breakout (the shared grain)')
  }

  // Every referenced field resolves through the whitelist (local column or a
  // single-hop FK relation "<via>.<column>"); bins are eligible.
  for (const c of columns) {
    if (!resolveField(entity, entityMap, c)) fail(`Unknown column "${c}" on ${stage.source}`)
  }
  for (const b of breakouts) {
    if (b.unnest && b.expr) fail(`Breakout "${b.alias}" can't both unnest and use an expression`)
    if (b.unnest && b.bin) fail(`Breakout "${b.alias}" can't both unnest and bin`)
    if (b.unnest && !b.field) fail(`Unnest breakout "${b.alias}" needs a field`)
    // A computed-expression breakout (e.g. a CASE age bucket) — must be a plain
    // row-level expression, never an aggregate (you can't GROUP BY an aggregate).
    if (b.expr && b.field) fail(`Breakout "${b.alias}" can't have both a field and an expression`)
    if (b.expr) {
      validateExpr(entity, entityMap, b.expr, { allowAgg: false })
      continue
    }
    if (!b.field) fail(`Breakout "${b.alias}" needs a field or an expression`)
    const col = resolveField(entity, entityMap, b.field)
    if (!col) fail(`Unknown field "${b.field}" on ${stage.source}`)
    if (b.bin?.kind === 'temporal' && !(col.kind === 'date' || col.kind === 'timestamp')) {
      fail(`Field "${b.field}" can't be bucketed by time`)
    }
    if (b.bin?.kind === 'numeric' && col.kind !== 'number') {
      fail(`Field "${b.field}" can't be binned numerically`)
    }
    if (b.bin?.kind === 'numeric' && b.field.includes('.')) {
      fail('Numeric binning is only supported on a direct column, not a joined field')
    }
  }
  for (const m of baseMeasures) {
    const bm = m as BhqlMeasure
    validateMeasure(entity, entityMap, bm)
    if (bm.filter) validateFilterDepth(bm.filter)
  }
  // Custom-aggregation measures — an expression that may contain aggregate nodes.
  for (const m of exprMeasures) {
    validateExpr(entity, entityMap, (m as { expr: unknown }).expr, { allowAgg: true })
  }
  // A calc measure may combine base measures from the primary stage AND any
  // joined source (the cross-table ratio case, e.g. TRIR = recordables ÷ hours).
  const baseAliases = new Set([
    ...baseMeasures.map((m) => m.alias),
    ...joinedSources.flatMap((js) => js.measures.map((m) => m.alias)),
    ...metricRefs.map((mr) => mr.alias),
  ])
  for (const m of calcMeasures) {
    const cm = m as { numerator: string; denominator?: string }
    if (!baseAliases.has(cm.numerator)) {
      fail(`A calculated measure references unknown measure "${cm.numerator}"`)
    }
    if (cm.denominator && !baseAliases.has(cm.denominator)) {
      fail(`A calculated measure references unknown measure "${cm.denominator}"`)
    }
  }

  // order-by must reference a produced output (alias in grouped mode, column in raw mode).
  for (const o of stage.orderBy ?? []) {
    if (!aliases.has(o.ref) && !columns.includes(o.ref)) {
      fail(`order-by references unknown output "${o.ref}"`)
    }
  }

  // Pivot refs must resolve to in-stage breakouts/measures.
  if (q.display === 'pivot' && q.pivot) {
    const bset = new Set(breakouts.map((b) => b.alias))
    const mset = new Set(measures.map((m) => m.alias))
    for (const r of q.pivot.rows)
      if (!bset.has(r.breakout)) fail(`pivot row "${r.breakout}" is not a breakout`)
    for (const c of q.pivot.columns) {
      if (!bset.has(c.breakout)) fail(`pivot column "${c.breakout}" is not a breakout`)
    }
    for (const v of q.pivot.values)
      if (!mset.has(v.measure)) fail(`pivot value "${v.measure}" is not a measure`)
  }

  if (stage.filter) validateFilterDepth(stage.filter)

  // Clamp the row cap.
  const limit =
    typeof stage.limit === 'number' && Number.isFinite(stage.limit)
      ? Math.min(Math.max(Math.trunc(stage.limit), 1), MAX_LIMIT)
      : null

  return {
    version: 'bhql/1',
    display: q.display,
    pivot: q.pivot ?? null,
    stages: [{ ...stage, limit }],
  } as BhqlQuery
}

export function safeParseBhqlQuery(
  raw: unknown,
  entityMap: Record<string, ReportEntity>,
): { ok: true; query: BhqlQuery } | { ok: false; error: string } {
  try {
    return { ok: true, query: parseBhqlQuery(raw, entityMap) }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Invalid query' }
  }
}

/** Drop references that no longer resolve after a builder edit (e.g. a breakout
 *  was removed) so a half-edited query still previews instead of hard-failing.
 *  Self-contained: output aliases come from the query itself, no registry. */
export function pruneBhql(query: BhqlQuery): BhqlQuery {
  const stage = query.stages[0]
  if (!stage) return query
  const breakouts = stage.breakouts ?? []
  const measures = stage.aggregations ?? []
  const columns = stage.columns ?? []
  const outputs = new Set<string>([
    ...breakouts.map((b) => b.alias),
    ...measures.map((m) => m.alias),
    ...columns,
  ])
  const breakoutAliases = new Set(breakouts.map((b) => b.alias))
  const measureAliases = new Set(measures.map((m) => m.alias))

  const orderBy = (stage.orderBy ?? []).filter((o) => outputs.has(o.ref))

  let pivot = query.pivot ?? null
  if (pivot) {
    const rows = pivot.rows.filter((r) => breakoutAliases.has(r.breakout))
    const columnsRef = pivot.columns.filter((c) => breakoutAliases.has(c.breakout))
    const values = pivot.values.filter((v) => measureAliases.has(v.measure))
    pivot =
      rows.length && columnsRef.length && values.length
        ? { ...pivot, rows, columns: columnsRef, values }
        : null
  }

  return {
    ...query,
    pivot,
    display: query.display === 'pivot' && !pivot ? 'table' : query.display,
    stages: [{ ...stage, orderBy }],
  }
}
