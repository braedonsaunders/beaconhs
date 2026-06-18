// User-buildable Insights dashboards. Each user keeps MANY named dashboards
// (surfaced as tabs in /insights). A dashboard is a 12-col grid of widgets where
// each widget's `id` is EITHER a built-in widget catalogue key OR an
// insight_cards.id (a saved query+viz Card) — so existing dashboards keep
// working with no data migration while engine-backed Cards drop in alongside.
//
// Dashboards (and Cards, in ./insights) can be PUBLISHED to a permission-aware
// library (status + allowedRoles, mirroring Forms) and pinned by other users
// (insight_dashboard_pins, in ./insights).

import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, users } from './core'

/** Shared by Cards + dashboards so the publish UI is identical. */
export const insightCardKind = pgEnum('insight_card_kind', ['question', 'model', 'metric', 'ai'])
export const insightShareStatus = pgEnum('insight_share_status', ['draft', 'published'])

export type InsightDashboardWidget = {
  /** A built-in widget catalogue key, or an insight_cards.id (uuid). */
  id: string
  x: number
  y: number
  w: number
  h: number
}
export type InsightDashboardLayout = { widgets: InsightDashboardWidget[] }

/** Dashboard-level filters that fan out into mapped cards' queries at run time. */
export type DashboardParamType = 'date' | 'text' | 'number' | 'enum'
export type DashboardParam = {
  key: string
  label: string
  type: DashboardParamType
  defaultValue?: string | number | null
}
/** paramKey → list of (cardId, field) the value is injected into as a filter. */
export type DashboardParamMapEntry = { cardId: string; field: string }
export type DashboardParamMap = Record<string, DashboardParamMapEntry[]>

export const insightDashboards = pgTable(
  'insight_dashboards',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** The owner. (Kept as user_id — it already meant the owner.) */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    layout: jsonb('layout').$type<InsightDashboardLayout>().default({ widgets: [] }).notNull(),
    params: jsonb('params').$type<DashboardParam[]>().default([]).notNull(),
    paramMap: jsonb('param_map').$type<DashboardParamMap>().default({}).notNull(),
    // Publishing (mirrors Forms): draft is private to the owner; published is
    // visible in the library to roles in allowedRoles (null/empty = everyone who
    // can read insights).
    status: insightShareStatus('status').default('draft').notNull(),
    allowedRoles: jsonb('allowed_roles').$type<string[]>(),
    publishedBy: text('published_by').references(() => users.id),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantUserIdx: index('insight_dashboards_tenant_user_idx').on(t.tenantId, t.userId),
    tenantStatusIdx: index('insight_dashboards_tenant_status_idx').on(t.tenantId, t.status),
  }),
)
