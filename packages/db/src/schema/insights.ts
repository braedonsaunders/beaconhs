// BHQL — the Insights query AST.
//
// A serializable, stage-based structured query (Metabase-MBQL parity, narrowed
// to a single Postgres dialect). It is persisted as jsonb on `insight_cards.query`
// and compiled to SQL by @beaconhs/analytics/server. The AST *types* live here —
// next to the table that stores them, exactly like `ReportCustomQuery` lives in
// ./reports — so the column can be typed `$type<BhqlQuery>()` while the zod
// validator, the SQL compiler and the semantic/viz layers all live in
// @beaconhs/analytics (which imports these types).
//
// The filter shape is REUSED verbatim from ./reports (`ReportRuleGroup`), so the
// existing injection-safe `compileRuleGroup` compiles a BHQL WHERE unchanged and
// dashboard-parameter injection is a pure append of `ReportRule`s.
//
// (The cards/dashboards/pins TABLES are added to this file in a later phase.)

import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, users } from './core'
import { insightCardKind, insightDashboards, insightShareStatus } from './insight-dashboards'
import type { ReportRuleGroup } from './reports'

export type BhqlVersion = 'bhql/1'

/** Aggregation functions a measure can apply. `count` is COUNT(*). */
export type BhqlAggFn = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max'

/** A measure (aggregation) producing one output column. `field` is omitted only
 *  for `fn: 'count'` (COUNT(*)); every other function requires a field. */
export type BhqlMeasure = {
  kind?: 'agg'
  fn: BhqlAggFn
  field?: string
  /** Output column key; unique within a stage; whitelist-safe slug. */
  alias: string
  /** Conditional aggregate — only count/sum rows matching this sub-filter
   *  (compiles to `<agg> FILTER (WHERE …)`). Reuses the report filter tree, so a
   *  "count of recordable incidents" or "count of compliant people" is one measure. */
  filter?: ReportRuleGroup | null
}

/** A measure COMPUTED from other (base) measures — ratios, percentages, rates.
 *  `numerator / denominator * multiplier`. e.g. a percentage =
 *  compliant/total×100; TRIR = recordables/hours×200000. Referenced base
 *  measures must exist in the same stage. */
export type BhqlCalcMeasure = {
  kind: 'calc'
  alias: string
  /** Base measure alias. */
  numerator: string
  /** Base measure alias; omit for a plain scaled measure. */
  denominator?: string
  /** Scale factor (×100 for a percentage, ×200000 for an OSHA rate; default 1). */
  multiplier?: number
}

/** A custom-aggregation measure: an arbitrary expression that may contain
 *  aggregate nodes — e.g. `datediff('day', max(occurred_at), now())` (days since)
 *  or `sum(hours) / count(*)`. This is the Metabase "custom aggregation". */
export type BhqlExprMeasure = {
  kind: 'expr'
  alias: string
  expr: BhqlExpr
}

export type BhqlAnyMeasure = BhqlMeasure | BhqlCalcMeasure | BhqlExprMeasure

export type BhqlTemporalUnit = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** A computed expression over columns + literals — arithmetic, comparison,
 *  CASE, and a whitelisted function library (date math, string, math). Powers
 *  computed dimensions (group by an expression) and custom aggregations, so
 *  derived values like "days since last recordable" or an age bucket are
 *  buildable in the UI with NO database view. Compiled by @beaconhs/analytics;
 *  every function + column + operator is whitelisted before it reaches SQL. */
export type BhqlExpr =
  | { ex: 'field'; field: string } // a column ref (supports a joined "via.col" path)
  | { ex: 'lit'; value: string | number | boolean | null }
  | { ex: 'arith'; op: '+' | '-' | '*' | '/'; left: BhqlExpr; right: BhqlExpr }
  | { ex: 'compare'; op: '=' | '!=' | '<' | '<=' | '>' | '>='; left: BhqlExpr; right: BhqlExpr }
  | { ex: 'isnull'; arg: BhqlExpr; negated?: boolean } // x IS [NOT] NULL
  | { ex: 'logic'; op: 'and' | 'or' | 'not'; args: BhqlExpr[] }
  | { ex: 'case'; branches: { when: BhqlExpr; then: BhqlExpr }[]; else?: BhqlExpr }
  | { ex: 'call'; fn: string; args: BhqlExpr[] }
  | { ex: 'agg'; fn: BhqlAggFn; arg?: BhqlExpr; filter?: ReportRuleGroup | null }

/** Bucketing applied to a breakout dimension. */
export type BhqlBin =
  { kind: 'temporal'; unit: BhqlTemporalUnit } | { kind: 'numeric'; numBins: number }

/** A group-by dimension, optionally bucketed. Exactly one of `field` (a column
 *  ref) or `expr` (a computed expression — e.g. a CASE age bucket) is set. */
export type BhqlBreakout = {
  field?: string
  /** A computed expression to group by, instead of a plain column. */
  expr?: BhqlExpr
  /** Output column key; unique within a stage; whitelist-safe slug. */
  alias: string
  bin?: BhqlBin
  /** Expand an array / jsonb-array column (e.g. a tags column) to one row per
   *  element, then group by the element. `array` = a Postgres array column
   *  (`unnest`); `jsonb` = a jsonb array (`jsonb_array_elements_text`). Mutually
   *  exclusive with `expr` and `bin`. */
  unnest?: 'array' | 'jsonb'
}

/** References into a stage's own breakouts/measures, by alias. */
export type BhqlBreakoutRef = { breakout: string }
export type BhqlMeasureRef = { measure: string }

export type BhqlPivotSubtotals = 'none' | 'rows' | 'both'

/** Pivot shaping: which breakouts go on the row axis vs column axis, and which
 *  measures fill the cells. Honored only when `display: 'pivot'`. */
export type BhqlPivot = {
  rows: BhqlBreakoutRef[]
  columns: BhqlBreakoutRef[]
  values: BhqlMeasureRef[]
  subtotals?: BhqlPivotSubtotals
}

export type BhqlOrderBy = {
  /** An output alias (a breakout/measure alias) or, in raw-row mode, a column key. */
  ref: string
  direction: 'asc' | 'desc'
}

/** Aligns a joined source to the primary grain: maps a primary-stage breakout
 *  (by alias) to the field on the joined source that supplies the same value,
 *  bucketed identically when the primary breakout is binned. The join equates
 *  the two. */
export type BhqlJoinKey = {
  /** A primary-stage breakout alias. */
  breakout: string
  /** The field on the joined source that supplies the same grain value. */
  field: string
  /** Match the primary breakout's bin (e.g. both bucketed by month). */
  bin?: BhqlBin
}

/** An additional source, aggregated independently and FULL OUTER JOINed to the
 *  primary stage on the shared-grain breakout dimensions. This is how a card
 *  crosses TABLES for a metric whose parts live apart — e.g. TRIR = recordable
 *  incidents (from `incidents`) ÷ hours worked (from `incident_hours_periods`)
 *  × 200000 — with NO database view. Each joined source is GROUP-BY'd to the
 *  primary's grain; its measures become referenceable by the stage's top-level
 *  calc measures. */
export type BhqlJoinedSource = {
  /** Entity/table key — validated against the discovered registry. */
  source: string
  filter?: ReportRuleGroup | null
  /** Aggregates produced from THIS source. Aliases are unique across the whole
   *  query (primary stage + every joined source). */
  measures: BhqlMeasure[]
  /** Maps every primary breakout to a field on this source (the shared grain). */
  on: BhqlJoinKey[]
}

/** A dimension source in a spine — its cross-product with the other dimensions
 *  forms the row space. Columns are addressed as "<alias>.<column>" (and
 *  "<alias>.<fk>.<column>" to follow a relation) in breakouts/measures/exprs. */
export type BhqlSpineSource = {
  alias: string
  source: string
  filter?: ReportRuleGroup | null
}

/** A fact source LEFT-JOINed onto the spine, optionally reduced to the single
 *  latest row per spine key (a correlated LATERAL `ORDER BY … LIMIT 1`). Its
 *  columns are addressed as "<alias>.<column>". */
export type BhqlSpineFact = {
  alias: string
  source: string
  filter?: ReportRuleGroup | null
  /** Correlate to the spine: each fact field equals a spine field ref. */
  on: { field: string; equals: string }[]
  /** Reduce to one row per spine key by this ordering (omit = plain LEFT JOIN). */
  latestBy?: BhqlOrderBy[]
}

/** A reference to a reusable Metric card (kind='metric') used as a measure in
 *  THIS query. The executor loads the metric at run time and expands it into a
 *  joined source (so editing the metric propagates to every card that uses it).
 *  `on` maps each primary breakout to a field on the metric's source — the
 *  shared grain — exactly like a joined source. */
export type BhqlMetricRef = {
  metricId: string
  /** Output alias for the metric's measure in this query (referenceable by a calc). */
  alias: string
  on: BhqlJoinKey[]
}

/** A fact-free dimension grid (cross-product of dimension sources) plus optional
 *  latest-fact joins — the generic form behind a coverage matrix (people ×
 *  courses ⟕ latest training record → coverage status), buildable with NO view.
 *  A spine's breakouts/measures/expressions address columns by
 *  "<sourceAlias>.<column>". */
export type BhqlSpine = {
  dimensions: BhqlSpineSource[]
  facts?: BhqlSpineFact[]
}

/** One analysis stage. v1 emits exactly one. The array shape is forward-compat
 *  for post-aggregation stages without a jsonb migration. */
export type BhqlStage = {
  /** Entity/table key — validated at run time against the discovered registry.
   *  Ignored when `spine` is set (the spine defines the FROM). */
  source: string
  filter?: ReportRuleGroup | null
  aggregations?: BhqlAnyMeasure[]
  breakouts?: BhqlBreakout[]
  /** Additional aggregated sources joined to the primary on the shared grain —
   *  unlocks cross-table metrics (ratios across tables) with no view. Their
   *  measures are available to this stage's calc measures. */
  joinedSources?: BhqlJoinedSource[]
  /** A dimension cross-product + latest-fact joins (the coverage-matrix form).
   *  When set, breakouts/measures address columns as "<sourceAlias>.<column>". */
  spine?: BhqlSpine
  /** References to reusable Metric cards, resolved to joined sources at run time
   *  (live propagation). Their measures are available to this stage's calcs. */
  metricRefs?: BhqlMetricRef[]
  /** Raw-row mode (no aggregations/breakouts): entity columns to SELECT. */
  columns?: string[]
  orderBy?: BhqlOrderBy[]
  limit?: number | null
}

export type BhqlDisplay = 'table' | 'pivot'

export type BhqlQuery = {
  version: BhqlVersion
  stages: BhqlStage[]
  display: BhqlDisplay
  pivot?: BhqlPivot | null
}

// --- Card kind configs ------------------------------------------------------

/** How an AI card shapes the model's output for rendering. */
export type AiCardOutputShape = 'summary' | 'bullets' | 'insights'

/** Config for an `ai` card: the model analyses the card's BHQL dataset (its
 *  `query`) under `prompt` and the result is rendered as prose/bullets. The
 *  dataset is a normal BHQL query, so AI cards are fully user-buildable. */
export type AiCardConfig = {
  kind: 'ai'
  prompt: string
  output: AiCardOutputShape
}

/** Config for a reusable `metric` card: maps a shared-dimension key (e.g.
 *  'time', 'site') to the metric source's column that supplies it, so a question
 *  card can JOIN this metric onto its own grain (the cross-source machinery). */
export type MetricCardConfig = {
  kind: 'metric'
  dims: Record<string, string>
}

export type InsightCardConfig = AiCardConfig | MetricCardConfig

// --- Tables -----------------------------------------------------------------

/** A Card = a saved query (BHQL) + a chosen visualization + its settings. The
 *  reusable unit placed onto dashboards and published to the library. */
export const insightCards = pgTable(
  'insight_cards',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => users.id),
    name: text('name').notNull(),
    description: text('description'),
    kind: insightCardKind('kind').default('question').notNull(),
    /** The BHQL query AST (opaque jsonb; validated by @beaconhs/analytics at the boundary). */
    query: jsonb('query').$type<BhqlQuery>().notNull(),
    vizType: text('viz_type').default('table').notNull(),
    vizSettings: jsonb('viz_settings').$type<Record<string, unknown>>().default({}).notNull(),
    /** Kind-specific config: AI prompt/output for `ai` cards, shared-dimension
     *  bindings for `metric` cards. Null for plain `question` cards. */
    config: jsonb('config').$type<InsightCardConfig | null>(),
    status: insightShareStatus('status').default('draft').notNull(),
    allowedRoles: jsonb('allowed_roles').$type<string[]>(),
    publishedBy: text('published_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('insight_cards_tenant_idx').on(t.tenantId),
    tenantStatusIdx: index('insight_cards_tenant_status_idx').on(t.tenantId, t.status),
    tenantCreatorIdx: index('insight_cards_tenant_creator_idx').on(t.tenantId, t.createdBy),
  }),
)

/** Per-user pinned dashboards — a user's /insights tabs are their OWN dashboards
 *  plus the published dashboards they've pinned from the library. */
export const insightDashboardPins = pgTable(
  'insight_dashboard_pins',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dashboardId: uuid('dashboard_id')
      .notNull()
      .references(() => insightDashboards.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    userDashUx: uniqueIndex('insight_dashboard_pins_user_dashboard_ux').on(t.userId, t.dashboardId),
    tenantUserIdx: index('insight_dashboard_pins_tenant_user_idx').on(t.tenantId, t.userId),
  }),
)
