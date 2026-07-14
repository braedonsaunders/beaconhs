// External data sync — connector instances + identity crosswalk + run ledger.
//
// One generic spine that every connector (database / csv / nango / …) lands
// through. A connector is code (registered in @beaconhs/sync); a CONNECTION is
// a tenant's configured instance of one. The crosswalk maps each external
// record to the canonical row it created/updated (people / org_units /
// equipment_items) so re-syncs are idempotent and write-back is possible later.

import {
  boolean,
  foreignKey,
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
// "contact" = a non-employee person attached to a location (customer_contacts).
export const SYNC_ENTITIES = ['people', 'org_unit', 'equipment', 'contact'] as const
export type SyncEntityKey = (typeof SYNC_ENTITIES)[number]

export type SyncConnectionStatus = 'draft' | 'connected' | 'error' | 'disabled'
export type SyncRunTrigger = 'scheduled' | 'manual' | 'preview'
export type SyncRunStatus = 'running' | 'success' | 'partial' | 'error'
export type SyncRecordAction =
  'created' | 'updated' | 'unchanged' | 'skipped' | 'failed' | 'archived' | 'conflict'
export type SyncRecordDiff = Record<string, { before: unknown; after: unknown }>

// Per-entity counters recorded on every run.
export type SyncEntityStat = {
  pulled: number
  created: number
  updated: number
  unchanged: number
  skipped: number
  failed: number
  archived: number
  conflict: number
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
    // Per-connector high-water mark for incremental pulls. Shape is connector-defined.
    cursor: jsonb('cursor').$type<Record<string, unknown>>().default({}).notNull(),
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
    tenantIdIdUx: uniqueIndex('sync_connections_tenant_id_id_ux').on(t.tenantId, t.id),
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
    connectionId: uuid('connection_id').notNull(),
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
    // A canonical row has one authoritative inbound owner. Without this,
    // natural-key matching lets two connections alternately overwrite the
    // same person/equipment/location while each believes it owns the row.
    canonicalOwner: uniqueIndex('sync_crosswalk_tenant_entity_canonical_owner_ux').on(
      t.tenantId,
      t.entity,
      t.canonicalId,
    ),
    connectionFk: foreignKey({
      name: 'sync_crosswalk_tenant_connection_fk',
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [syncConnections.tenantId, syncConnections.id],
    }).onDelete('cascade'),
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
    connectionId: uuid('connection_id').notNull(),
    trigger: text('trigger').$type<SyncRunTrigger>().notNull(),
    dryRun: boolean('dry_run').default(false).notNull(),
    status: text('status').$type<SyncRunStatus>().default('running').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    durationMs: integer('duration_ms'),
    stats: jsonb('stats').$type<Record<string, SyncEntityStat>>().default({}).notNull(),
    cursorBefore: jsonb('cursor_before').$type<Record<string, unknown>>().default({}).notNull(),
    cursorAfter: jsonb('cursor_after').$type<Record<string, unknown>>().default({}).notNull(),
    error: text('error'),
    log: jsonb('log').$type<SyncRunLogLine[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('sync_runs_tenant_idx').on(t.tenantId),
    connectionIdx: index('sync_runs_connection_idx').on(t.tenantId, t.connectionId, t.startedAt),
    tenantIdIdUx: uniqueIndex('sync_runs_tenant_id_id_ux').on(t.tenantId, t.id),
    connectionFk: foreignKey({
      name: 'sync_runs_tenant_connection_fk',
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [syncConnections.tenantId, syncConnections.id],
    }).onDelete('cascade'),
  }),
)

// Per-record execution ledger. This is what makes previews, first-run review,
// conflict triage, and later support audits possible without coupling the UI to
// connector internals.
export const syncRecordChanges = pgTable(
  'sync_record_changes',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull(),
    runId: uuid('run_id').notNull(),
    entity: text('entity').$type<SyncEntityKey>().notNull(),
    externalId: text('external_id').notNull(),
    canonicalId: uuid('canonical_id'),
    action: text('action').$type<SyncRecordAction>().notNull(),
    dryRun: boolean('dry_run').default(false).notNull(),
    rowHash: text('row_hash'),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    diff: jsonb('diff').$type<SyncRecordDiff | null>(),
    message: text('message'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('sync_record_changes_tenant_idx').on(t.tenantId),
    runIdx: index('sync_record_changes_run_idx').on(t.tenantId, t.runId),
    connectionRunIdx: index('sync_record_changes_connection_run_idx').on(
      t.tenantId,
      t.connectionId,
      t.runId,
    ),
    entityActionIdx: index('sync_record_changes_entity_action_idx').on(
      t.tenantId,
      t.entity,
      t.action,
    ),
    externalIdx: index('sync_record_changes_external_idx').on(
      t.tenantId,
      t.connectionId,
      t.entity,
      t.externalId,
    ),
    connectionFk: foreignKey({
      name: 'sync_record_changes_tenant_connection_fk',
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [syncConnections.tenantId, syncConnections.id],
    }).onDelete('cascade'),
    runFk: foreignKey({
      name: 'sync_record_changes_tenant_run_fk',
      columns: [t.tenantId, t.runId],
      foreignColumns: [syncRuns.tenantId, syncRuns.id],
    }).onDelete('cascade'),
  }),
)

export type SyncConnection = typeof syncConnections.$inferSelect
export type NewSyncConnection = typeof syncConnections.$inferInsert
export type SyncCrosswalkRow = typeof syncCrosswalk.$inferSelect
export type SyncRun = typeof syncRuns.$inferSelect
export type SyncRecordChange = typeof syncRecordChanges.$inferSelect
