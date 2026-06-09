// User-buildable Insights dashboards. Unlike the single personal dashboard
// layout (user_dashboard_layouts), each user can keep MANY named dashboards
// here — they surface as tabs in /insights. Each is a 12-col grid of widgets
// (id = widget catalogue key, single instance per dashboard, x/y/w/h).

import { index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

export type InsightDashboardLayout = {
  widgets: Array<{
    id: string
    x: number
    y: number
    w: number
    h: number
  }>
}

export const insightDashboards = pgTable(
  'insight_dashboards',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    layout: jsonb('layout').$type<InsightDashboardLayout>().default({ widgets: [] }).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantUserIdx: index('insight_dashboards_tenant_user_idx').on(t.tenantId, t.userId),
  }),
)
