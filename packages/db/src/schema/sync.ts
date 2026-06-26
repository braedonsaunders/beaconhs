// External data sync — connector instances + identity crosswalk + run ledger.
//
// One generic spine that every connector (database / csv / nango / …) lands
// through. A connector is code (registered in @beaconhs/sync); a CONNECTION is
// a tenant's configured instance of one. The crosswalk maps each external
// record to the canonical row it created/updated (people / org_units /
// equipment_items) so re-syncs are idempotent and write-back is possible later.

import {
  boolean,
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
import { tenants } from './core'

// The canonical entities a connector can sync into. NOTE: "org_unit" covers
// both Locations and Projects (the same org_units table, different `level`).
// "work_activity" is source-neutral operational activity (hours, site, km) that
// downstream modules such as vehicle logs can import from without knowing which
// upstream system produced it.
export const SYNC_ENTITIES = ['people', 'org_unit', 'equipment', 'work_activity'] as const
export type SyncEntityKey = (typeof SYNC_ENTITIES)[number]

export type SyncConnectionStatus = 'draft' | 'connected' | 'error' | 'disabled'
export type SyncRunTrigger = 'scheduled' | 'manual'
export type SyncRunStatus = 'running' | 'success' | 'partial' | 'error'

// Per-entity counters recorded on every run.
export type SyncEntityStat = {
  pulled: number
  created: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
}

export type SyncRunLogLine = { at: string; level: 'info' | 'warn' | 'error'; msg: string }

// A tenant's configured instance of a connector.
export const syncConnections = pgTable(
  'sync_connections',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Which connector in the @beaconhs/sync registry ('database' | 'csv' | 'nango' | …).
    connectorKey: text('connector_key').notNull(),
    name: text('name').notNull(),
    // Auth / reachability status (distinct from the schedule on/off below).
    status: text('status').$type<SyncConnectionStatus>().default('draft').notNull(),
    // Schedule on/off + cron. enabled=false means "configured but not scheduled".
    enabled: boolean('enabled').default(false).notNull(),
    schedule: text('schedule'), // 5-field cron, null = manual-only
    // Connector-specific, non-secret config (db host/mappings, csv text, nango ids …).
    config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
    // Sealed secrets (AES-GCM), keyed by name → { ciphertext, nonce }. Never echoed.
    secrets: jsonb('secrets')
      .$type<Record<string, { ciphertext: string; nonce: string }>>()
      .default({})
      .notNull(),
    // Denormalised last-run summary for the list UI.
    lastRunId: uuid('last_run_id'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastStatus: text('last_status').$type<SyncRunStatus>(),
    lastError: text('last_error'),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('sync_connections_tenant_idx').on(t.tenantId),
    tenantConnectorIdx: index('sync_connections_connector_idx').on(t.tenantId, t.connectorKey),
  }),
)

// External ↔ canonical identity map. The durable spine: enables idempotent
// re-sync (match by externalId), change detection (rowHash) and future
// write-back (reverse lookup canonicalId → externalId).
export const syncCrosswalk = pgTable(
  'sync_crosswalk',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => syncConnections.id, { onDelete: 'cascade' }),
    entity: text('entity').$type<SyncEntityKey>().notNull(),
    sourceSystem: text('source_system').notNull(), // connectorKey, for labelling
    externalId: text('external_id').notNull(),
    canonicalId: uuid('canonical_id').notNull(), // people.id | org_units.id | equipment_items.id
    rowHash: text('row_hash').notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    uniq: uniqueIndex('sync_crosswalk_uniq').on(t.tenantId, t.connectionId, t.entity, t.externalId),
    canonicalIdx: index('sync_crosswalk_canonical_idx').on(t.tenantId, t.entity, t.canonicalId),
  }),
)

// Execution ledger — one row per sync attempt.
export const syncRuns = pgTable(
  'sync_runs',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => syncConnections.id, { onDelete: 'cascade' }),
    trigger: text('trigger').$type<SyncRunTrigger>().notNull(),
    status: text('status').$type<SyncRunStatus>().default('running').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    stats: jsonb('stats').$type<Record<string, SyncEntityStat>>().default({}).notNull(),
    error: text('error'),
    log: jsonb('log').$type<SyncRunLogLine[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('sync_runs_tenant_idx').on(t.tenantId),
    connectionIdx: index('sync_runs_connection_idx').on(t.connectionId, t.startedAt),
  }),
)

export type SyncConnection = typeof syncConnections.$inferSelect
export type NewSyncConnection = typeof syncConnections.$inferInsert
export type SyncCrosswalkRow = typeof syncCrosswalk.$inferSelect
export type SyncRun = typeof syncRuns.$inferSelect
