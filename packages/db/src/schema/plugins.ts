// Plugin registry + per-tenant enablement + encrypted secrets + event log.

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
import { tenants } from './core'

// Catalogue row per plugin available to install. Created by your team.
export const plugins = pgTable(
  'plugins',
  {
    id: id(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    version: text('version').notNull(),
    // Declared capabilities. Subset of: sync.in, sync.out, ui.panel, field.type, report.type
    capabilities: jsonb('capabilities').$type<string[]>().default([]).notNull(),
    // Plugin manifest (Zod schema for config + UI panel slots + hooks)
    manifest: jsonb('manifest').$type<Record<string, unknown>>().default({}).notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    keyUx: uniqueIndex('plugins_key_ux').on(t.key),
  }),
)

export const tenantPlugins = pgTable(
  'tenant_plugins',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    pluginId: uuid('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').default(true).notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('tenant_plugins_uniq').on(t.tenantId, t.pluginId),
    tenantIdx: index('tenant_plugins_tenant_idx').on(t.tenantId),
  }),
)

// Encrypted secrets (envelope encrypted; ciphertext + DEK reference).
export const tenantPluginSecrets = pgTable(
  'tenant_plugin_secrets',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tenantPluginId: uuid('tenant_plugin_id')
      .notNull()
      .references(() => tenantPlugins.id, { onDelete: 'cascade' }),
    keyName: text('key_name').notNull(),
    ciphertext: text('ciphertext').notNull(),
    nonce: text('nonce').notNull(),
    keyVersion: text('key_version').notNull(),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('tenant_plugin_secrets_uniq').on(t.tenantPluginId, t.keyName),
    tenantIdx: index('tenant_plugin_secrets_tenant_idx').on(t.tenantId),
  }),
)

// Outbound event log (for plugin sync.out + webhooks). Drives retry + audit.
export const pluginEventStatus = ['pending', 'delivered', 'failed', 'dead'] as const

export const pluginEvents = pgTable(
  'plugin_events',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    tenantPluginId: uuid('tenant_plugin_id').references(() => tenantPlugins.id, {
      onDelete: 'cascade',
    }),
    event: text('event').notNull(), // 'incident.created' etc.
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: text('status').default('pending').notNull(),
    attempts: jsonb('attempts')
      .$type<{ at: string; status: number; error?: string }[]>()
      .default([])
      .notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('plugin_events_tenant_idx').on(t.tenantId, t.event),
    pendingIdx: index('plugin_events_pending_idx').on(t.status, t.nextAttemptAt),
  }),
)
