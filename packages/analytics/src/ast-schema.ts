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
import { REPORT_OPERATORS, entityColumn, type ReportEntity } from '@beaconhs/reports/entities'
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

const zMeasure = z.object({
  kind: z.literal('agg').optional(),
  fn: z.enum(['count', 'count_distinct', 'sum', 'avg', 'min', 'max']),
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

const zAnyMeasure = z.union([zMeasure, zCalcMeasure])

const zBreakout = z.object({
  field: z.string(),
  alias: z.string(),
  bin: zBin.optional(),
})

const zPivot = z.object({
  rows: z.array(z.object({ breakout: z.string() })).min(1),
  columns: z.array(z.object({ breakout: z.string() })).min(1),
  values: z.array(z.object({ measure: z.string() })).min(1),
  subtotals: z.enum(['none', 'rows', 'both']).optional(),
})

const zStage = z.object({
  source: z.string(),
  filter: zRuleGroup.nullish(),
  aggregations: z.array(zAnyMeasure).optional(),
  breakouts: z.array(zBreakout).optional(),
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

// ---- semantic validation (registry-aware) ----------------------------------

function fail(message: string): never {
  throw new BhqlValidationError(message)
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

function validateMeasure(entity: ReportEntity, m: BhqlMeasure): void {
  if (m.fn === 'count') {
    if (m.field) fail('count takes no field')
    return
  }
  if (!m.field) fail(`${m.fn} requires a field`)
  const col = entityColumn(entity, m.field)
  if (!col) fail(`Unknown field "${m.field}" on ${entity.key}`)
  if ((m.fn === 'sum' || m.fn === 'avg') && col.kind !== 'number') {
    fail(`${m.fn} requires a numeric field (got "${m.field}")`)
  }
  // min/max work on any orderable column (text/enum/date/number). Allowing them
  // on a categorical column lets a pivot surface a single per-cell status string
  // (e.g. the training-matrix coverage), since min() of one value is that value.
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

  const entity = entityMap[stage.source]
  if (!entity) fail(`Unknown source entity "${stage.source}"`)

  const measures = stage.aggregations ?? []
  const baseMeasures = measures.filter((m) => (m as { kind?: string }).kind !== 'calc')
  const calcMeasures = measures.filter((m) => (m as { kind?: string }).kind === 'calc')
  const breakouts = stage.breakouts ?? []
  const columns = stage.columns ?? []

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

  // Every referenced field resolves through the whitelist; bins are eligible.
  for (const c of columns) {
    if (!entityColumn(entity, c)) fail(`Unknown column "${c}" on ${stage.source}`)
  }
  for (const b of breakouts) {
    const col = entityColumn(entity, b.field)
    if (!col) fail(`Unknown field "${b.field}" on ${stage.source}`)
    if (b.bin?.kind === 'temporal' && !(col.kind === 'date' || col.kind === 'timestamp')) {
      fail(`Field "${b.field}" can't be bucketed by time`)
    }
    if (b.bin?.kind === 'numeric' && col.kind !== 'number') {
      fail(`Field "${b.field}" can't be binned numerically`)
    }
  }
  for (const m of baseMeasures) {
    const bm = m as BhqlMeasure
    validateMeasure(entity, bm)
    if (bm.filter) validateFilterDepth(bm.filter)
  }
  const baseAliases = new Set(baseMeasures.map((m) => m.alias))
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
