// User-customisable dashboard layouts.
//
// Each user (per tenant) can save one personal layout. If they haven't
// saved one, the page falls back to the role-default layout shipped in
// `apps/web/src/app/(app)/dashboard/_role-defaults.ts`.
//
// Layout schema is a jsonb { widgets: [{ id, x, y, w, h }] } where each
// widget id matches an entry in the central widget registry. The grid
// is 12 columns wide; row height is set in the client.

import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

/**
 * A single user-defined "Quick action" tile. Stored alongside the layout so a
 * user's personal shortcuts travel with their dashboard. `tone`/`iconKey` are
 * loose strings (resolved + fallback-mapped client-side) so adding new colours
 * or icons never invalidates a persisted row. `href` is an internal path
 * ("/incidents/new") or an absolute http(s) URL.
 */
export type DashboardQuickAction = {
  id: string
  label: string
  href: string
  iconKey: string
  tone: string
}

export type DashboardLayoutData = {
  widgets: Array<{
    /** Widget registry id (e.g. 'trir', 'capa-aging') */
    id: string
    x: number
    y: number
    w: number
    h: number
  }>
  /** Per-user Quick-actions widget config. Undefined ⇒ fall back to defaults. */
  quickActions?: DashboardQuickAction[]
}

export const userDashboardLayouts = pgTable(
  'user_dashboard_layouts',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    layout: jsonb('layout').$type<DashboardLayoutData>().notNull(),
    // Tracks which role the user had when they first customised — so a
    // promotion lets the new role's default win again.
    sourceRole: text('source_role'),
    isCustomised: boolean('is_customised').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    userUx: uniqueIndex('user_dashboard_layouts_user_ux').on(t.tenantId, t.userId),
    tenantIdx: index('user_dashboard_layouts_tenant_idx').on(t.tenantId),
  }),
)
