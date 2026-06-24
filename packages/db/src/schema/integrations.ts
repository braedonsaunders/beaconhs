// Outbound integrations — the generic substrate that lets a tenant enable a
// first-party "push on a domain event" integration (disabled by default), and
// the export ledger that makes those pushes idempotent and reversible.
//
// This is deliberately vendor-neutral: the core app only ever emits generic
// events and stores per-tenant config/sealed secrets here. The actual mapping
// to an external system lives in a code-registered integration (see
// apps/web/src/lib/integrations), so nothing tenant-specific leaks into core.

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
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'

// Plain text union (no pg enum) so db:push never hits the enum rename-resolver
// — the same convention the sync tables use.
export type TenantIntegrationStatus = 'draft' | 'ready' | 'error' | 'disabled'

// One row per (tenant, integration) — enablement + non-secret config + sealed
// secrets, mirroring the sync_connections secret shape so the same
// sealSecret/unsealSecret helpers apply.
export const tenantIntegrations = pgTable(
  'tenant_integrations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    integrationKey: text('integration_key').notNull(), // registry key, e.g. 'adminapp2-timesheet'
    enabled: boolean('enabled').default(false).notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
    secrets: jsonb('secrets')
      .$type<Record<string, { ciphertext: string; nonce: string }>>()
      .default({})
      .notNull(),
    status: text('status').$type<TenantIntegrationStatus>().default('draft').notNull(),
    lastError: text('last_error'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('tenant_integrations_tenant_idx').on(t.tenantId),
    tenantKeyUx: uniqueIndex('tenant_integrations_tenant_key_ux').on(t.tenantId, t.integrationKey),
  }),
)

// One row per external record an integration created. Re-firing the same event
// (e.g. re-completing a training class) reverses the prior push — delete the
// external rows by external_ref — before re-inserting, so re-completion never
// double-posts. This is the idempotency the legacy "dump time on close" lacked.
export const integrationExportLog = pgTable(
  'integration_export_log',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    integrationKey: text('integration_key').notNull(),
    subjectType: text('subject_type').notNull(), // e.g. 'training_class'
    subjectId: uuid('subject_id').notNull(), // the internal subject (e.g. class id)
    externalSystem: text('external_system').notNull(), // e.g. 'adminapp2'
    externalRef: text('external_ref'), // id of the row we created in the external system
    status: text('status').notNull(), // 'pushed' | 'failed' | 'reversed'
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    ...timestamps,
  },
  (t) => ({
    subjectIdx: index('integration_export_log_subject_idx').on(
      t.tenantId,
      t.subjectType,
      t.subjectId,
    ),
    keyIdx: index('integration_export_log_key_idx').on(t.tenantId, t.integrationKey),
  }),
)
