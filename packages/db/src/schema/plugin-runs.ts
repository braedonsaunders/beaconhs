// Per-cadence plugin cron execution ledger.
//
// runPluginCron(cadence) inserts one row per enabled tenant_plugin whose
// manifest declares a cron job at this cadence. Until the plugin SDK runtime
// is in place, every row is recorded with status='skipped:no_runtime' — but
// the row is real, so the audit story holds and we can flip the worker on
// without changing the schema.

import { relations } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { tenantPlugins } from './plugins'

export const pluginRuns = pgTable(
  'plugin_runs',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tenantPluginId: uuid('tenant_plugin_id')
      .notNull()
      .references(() => tenantPlugins.id, { onDelete: 'cascade' }),
    cadence: text('cadence').notNull(), // 'minute' | 'hourly' | 'daily' | ...
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped:no_runtime' | ...
    status: text('status').notNull().default('queued'),
    durationMs: text('duration_ms'),
    summary: text('summary'),
    error: text('error'),
    details: jsonb('details').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('plugin_runs_tenant_idx').on(t.tenantId),
    pluginIdx: index('plugin_runs_plugin_idx').on(t.tenantPluginId, t.startedAt),
    cadenceIdx: index('plugin_runs_cadence_idx').on(t.cadence, t.startedAt),
  }),
)

export const pluginRunsRelations = relations(pluginRuns, ({ one }) => ({
  tenant: one(tenants, { fields: [pluginRuns.tenantId], references: [tenants.id] }),
  tenantPlugin: one(tenantPlugins, {
    fields: [pluginRuns.tenantPluginId],
    references: [tenantPlugins.id],
  }),
}))
