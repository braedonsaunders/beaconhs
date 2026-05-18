// Corrective actions are standalone, optionally linked to a source record
// (incident, form response, audit finding, etc.).

import { relations } from 'drizzle-orm'
import {
  date,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { orgUnits } from './org'

export const correctiveActionSeverity = pgEnum('corrective_action_severity', [
  'low',
  'medium',
  'high',
  'critical',
])

export const correctiveActionStatus = pgEnum('corrective_action_status', [
  'open',
  'in_progress',
  'pending_verification',
  'closed',
  'cancelled',
])

export const correctiveActions = pgTable(
  'corrective_actions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // e.g. CA-2026-0001
    title: text('title').notNull(),
    description: text('description'),
    severity: correctiveActionSeverity('severity').default('medium').notNull(),
    status: correctiveActionStatus('status').default('open').notNull(),
    ownerTenantUserId: uuid('owner_tenant_user_id').references(() => tenantUsers.id),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    dueOn: date('due_on'),
    rootCause: text('root_cause'),
    sourceEntityType: text('source_entity_type'), // 'incident' | 'form_response' | 'audit_finding'
    sourceEntityId: uuid('source_entity_id'),
    verificationNotes: text('verification_notes'),
    verifiedByTenantUserId: uuid('verified_by_tenant_user_id').references(() => tenantUsers.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('corrective_actions_tenant_idx').on(t.tenantId),
    statusIdx: index('corrective_actions_status_idx').on(t.tenantId, t.status),
    dueIdx: index('corrective_actions_due_idx').on(t.tenantId, t.dueOn),
    sourceIdx: index('corrective_actions_source_idx').on(
      t.tenantId,
      t.sourceEntityType,
      t.sourceEntityId,
    ),
  }),
)

export const correctiveActionsRelations = relations(correctiveActions, ({ one }) => ({
  tenant: one(tenants, { fields: [correctiveActions.tenantId], references: [tenants.id] }),
  owner: one(tenantUsers, {
    fields: [correctiveActions.ownerTenantUserId],
    references: [tenantUsers.id],
  }),
}))
