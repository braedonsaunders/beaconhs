// Corrective actions are standalone, optionally linked to a source record
// (incident, form response, audit finding, etc.).

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
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

export const correctiveActionSource = pgEnum('corrective_action_source', [
  'inspection',
  'incident',
  'near_miss',
  'observation',
  'audit',
  'jsha',
  'other',
])

export const correctiveActionCompleteStepKind = pgEnum(
  'corrective_action_complete_step_kind',
  ['action_taken', 'verification', 'signature'],
)

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
    assignedByTenantUserId: uuid('assigned_by_tenant_user_id').references(() => tenantUsers.id),
    ownerTenantUserId: uuid('owner_tenant_user_id').references(() => tenantUsers.id),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    assignedOn: date('assigned_on'),
    dueOn: date('due_on'),
    rootCause: text('root_cause'),
    actionTaken: text('action_taken'),
    source: correctiveActionSource('source'),
    sourceEntityType: text('source_entity_type'), // 'incident' | 'form_response' | 'audit_finding'
    sourceEntityId: uuid('source_entity_id'),
    // Typed FK shortcut to the form_response that spawned this CAPA. Coexists
    // with the polymorphic sourceEntityType/Id pair so the response-detail
    // page can join CAs back without an ad-hoc text equality filter.
    sourceFormResponseId: uuid('source_form_response_id'),
    // Verification flow — gated by `verificationRequired`. When set, the CA
    // can only move to 'closed' through the Verification tab where a verifier
    // (often a different tenantUser from the owner) signs off.
    verificationRequired: boolean('verification_required').default(false).notNull(),
    verificationNotes: text('verification_notes'),
    verifiedByTenantUserId: uuid('verified_by_tenant_user_id').references(() => tenantUsers.id),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    // Optional cost impact captured at close time so the by-source / aging
    // reports can roll up financial exposure.
    costImpact: numeric('cost_impact', { precision: 12, scale: 2 }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    locked: boolean('locked').default(false).notNull(),
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
    ownerIdx: index('corrective_actions_owner_idx').on(t.tenantId, t.ownerTenantUserId),
  }),
)

// Photos attached to a CA. Mirrors `incident_attachments` so the
// PhotoUploaderSection / PhotoGallery primitives can be reused without
// changes.
export const caPhotos = pgTable(
  'ca_photos',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    caId: uuid('ca_id')
      .notNull()
      .references(() => correctiveActions.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    caIdx: index('ca_photos_ca_idx').on(t.caId),
    tenantIdx: index('ca_photos_tenant_idx').on(t.tenantId),
  }),
)

// Multi-step complete-action audit trail.
// Each row represents one of: the worker recording the action taken, the
// verifier confirming the fix, and an optional captured signature. Ordering
// is by `entityOrder` so the UI can show the steps in the sequence they were
// recorded.
export const caCompleteSteps = pgTable(
  'ca_complete_steps',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    caId: uuid('ca_id')
      .notNull()
      .references(() => correctiveActions.id, { onDelete: 'cascade' }),
    kind: correctiveActionCompleteStepKind('kind').notNull(),
    description: text('description'),
    completedByTenantUserId: uuid('completed_by_tenant_user_id').references(
      () => tenantUsers.id,
    ),
    completedAt: timestamp('completed_at', { withTimezone: true }).defaultNow().notNull(),
    signatureDataUrl: text('signature_data_url'),
    entityOrder: integer('entity_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    caIdx: index('ca_complete_steps_ca_idx').on(t.caId, t.entityOrder),
    tenantIdx: index('ca_complete_steps_tenant_idx').on(t.tenantId),
  }),
)

export const correctiveActionsRelations = relations(correctiveActions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [correctiveActions.tenantId], references: [tenants.id] }),
  owner: one(tenantUsers, {
    fields: [correctiveActions.ownerTenantUserId],
    references: [tenantUsers.id],
  }),
  verifier: one(tenantUsers, {
    fields: [correctiveActions.verifiedByTenantUserId],
    references: [tenantUsers.id],
  }),
  photos: many(caPhotos),
  completeSteps: many(caCompleteSteps),
}))

export const caPhotosRelations = relations(caPhotos, ({ one }) => ({
  ca: one(correctiveActions, {
    fields: [caPhotos.caId],
    references: [correctiveActions.id],
  }),
}))

export const caCompleteStepsRelations = relations(caCompleteSteps, ({ one }) => ({
  ca: one(correctiveActions, {
    fields: [caCompleteSteps.caId],
    references: [correctiveActions.id],
  }),
  completedBy: one(tenantUsers, {
    fields: [caCompleteSteps.completedByTenantUserId],
    references: [tenantUsers.id],
  }),
}))
