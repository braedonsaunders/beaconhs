// UI walkthroughs (guided tours). The walkthrough DEFINITIONS (steps, targets,
// copy) are code — apps/web/src/lib/walkthroughs/registry.ts — because they must
// track the actual UI. These tables hold what varies per tenant/user:
//
// - walkthrough_settings: one row per (tenant, walkthrough) overriding the
//   built-in defaults — enabled, auto-start on first sign-in, and which roles
//   see it (empty roleIds = every role). Missing row = registry defaults.
// - walkthrough_progress: one row per (tenant, user, walkthrough) once the user
//   has completed or dismissed it, so auto-start tours never replay.

import { boolean, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, users } from './core'

export const walkthroughSettings = pgTable(
  'walkthrough_settings',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Key into WALKTHROUGHS in apps/web/src/lib/walkthroughs/registry.ts.
    walkthroughId: text('walkthrough_id').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    // Offer the tour automatically the first time a matching user signs in.
    // When false the tour is launch-on-demand only (from /help or admin preview).
    autoStart: boolean('auto_start').default(false).notNull(),
    // Role ids (roles.id) whose members see this tour. Empty = all roles.
    roleIds: jsonb('role_ids').$type<string[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('walkthrough_settings_uniq').on(t.tenantId, t.walkthroughId),
  }),
)

export const walkthroughProgress = pgTable(
  'walkthrough_progress',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    walkthroughId: text('walkthrough_id').notNull(),
    // 'completed' = walked every step; 'dismissed' = skipped/closed early.
    status: text('status').$type<'completed' | 'dismissed'>().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('walkthrough_progress_uniq').on(t.tenantId, t.userId, t.walkthroughId),
  }),
)
