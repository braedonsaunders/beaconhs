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
  | { ex: 'logic'; op: 'and' | 'or' | 'not'; args: BhqlExpr[] }
  | { ex: 'case'; branches: { when: BhqlExpr; then: BhqlExpr }[]; else?: BhqlExpr }
  | { ex: 'call'; fn: string; args: BhqlExpr[] }
  | { ex: 'agg'; fn: BhqlAggFn; arg?: BhqlExpr; filter?: ReportRuleGroup | null }

/** Bucketing applied to a breakout dimension. */
export type BhqlBin =
  | { kind: 'temporal'; unit: BhqlTemporalUnit }
  | { kind: 'numeric'; numBins: number }

/** A group-by dimension, optionally bucketed. Exactly one of `field` (a column
 *  ref) or `expr` (a computed expression — e.g. a CASE age bucket) is set. */
export type BhqlBreakout = {
  field?: string
  /** A computed expression to group by, instead of a plain column. */
  expr?: BhqlExpr
  /** Output column key; unique within a stage; whitelist-safe slug. */
  alias: string
  bin?: BhqlBin
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

/** One analysis stage. v1 emits exactly one. The array shape is forward-compat
 *  for post-aggregation stages without a jsonb migration. */
export type BhqlStage = {
  /** Entity/table key — validated at run time against the discovered registry. */
  source: string
  filter?: ReportRuleGroup | null
  aggregations?: BhqlAnyMeasure[]
  breakouts?: BhqlBreakout[]
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
