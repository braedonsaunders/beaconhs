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
  foreignKey,
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
    name: text('name'), // user label for a built automation
    triggerKey: text('trigger_key'), // event that fires it, e.g. 'incident.created'
    destinationKey: text('destination_key'), // service it sends to, e.g. 'http'
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
    triggerIdx: index('tenant_integrations_trigger_idx').on(t.tenantId, t.triggerKey),
    tenantIdIdUx: uniqueIndex('tenant_integrations_tenant_id_id_ux').on(t.tenantId, t.id),
  }),
)

// One row per external record an integration created. Re-firing the same event
// (e.g. re-completing a training class) reverses the prior push — delete the
// external rows by external_ref — before re-inserting, so re-completion never
// double-posts. This is the idempotency a naive re-insert would lack.
export const integrationExportLog = pgTable(
  'integration_export_log',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    automationId: uuid('automation_id').notNull(),
    subjectType: text('subject_type').notNull(), // e.g. 'training_class'
    subjectId: uuid('subject_id').notNull(), // the internal subject (e.g. class id)
    externalSystem: text('external_system').notNull(), // label for the target system, e.g. 'payroll-sql'
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
    automationIdx: index('integration_export_log_automation_idx').on(t.tenantId, t.automationId),
    automationFk: foreignKey({
      name: 'integration_export_log_tenant_automation_fk',
      columns: [t.tenantId, t.automationId],
      foreignColumns: [tenantIntegrations.tenantId, tenantIntegrations.id],
    }).onDelete('cascade'),
  }),
)
