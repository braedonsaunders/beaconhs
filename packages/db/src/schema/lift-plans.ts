// Lift Plans — depth implementation of the critical-lift workflow.
//
// The canonical `lift_plan_v1` form template (see canonical-templates.ts) stays
// as the quick form-builder version. This module is the first-class deep
// implementation: dedicated tables for loads, equipment, hazards, PPE,
// signatures, photos — plus status workflow, lock-on-completion, audit log.
//
// Mirrors the schema patterns used by incidents and hazid:
//   - reference auto-numbered LP-YYYY-NNNN
//   - tenantId on every table; cascade on tenant delete
//   - timestamps + (top-level only) softDelete
//   - entityOrder int on child rows for drag-reorder UX

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { orgUnits, people } from './org'
import { equipmentItems } from './equipment'

export const liftPlanStatus = pgEnum('lift_plan_status', [
  'draft',
  'approved',
  'in_progress',
  'completed',
  'cancelled',
])

export const liftPlanSignatureRole = pgEnum('lift_plan_signature_role', [
  'supervisor',
  'operator',
  'rigger',
  'signaler',
  'spotter',
])

// --- Top-level lift plan ---------------------------------------------------
export const liftPlans = pgTable(
  'lift_plans',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),

    // Where + when
    projectOrgUnitId: uuid('project_org_unit_id').references(() => orgUnits.id),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    liftDate: date('lift_date').notNull(),
    // Free-text scope (what the lift is for, special hazards summary, etc.)
    description: text('description'),

    // Core team (the legacy app fielded these as free-text; we now FK them)
    supervisorTenantUserId: uuid('supervisor_tenant_user_id').references(() => tenantUsers.id),
    operatorPersonId: uuid('operator_person_id').references(() => people.id),
    riggerPersonId: uuid('rigger_person_id').references(() => people.id),

    // Lifecycle
    status: liftPlanStatus('status').default('draft').notNull(),
    locked: boolean('locked').default(false).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedByTenantUserId: uuid('locked_by_tenant_user_id').references(() => tenantUsers.id),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByTenantUserId: uuid('completed_by_tenant_user_id').references(() => tenantUsers.id),

    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledByTenantUserId: uuid('cancelled_by_tenant_user_id').references(() => tenantUsers.id),
    cancellationReason: text('cancellation_reason'),

    // Audit attribution
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('lift_plans_tenant_idx').on(t.tenantId),
    referenceIdx: index('lift_plans_reference_idx').on(t.tenantId, t.reference),
    statusIdx: index('lift_plans_status_idx').on(t.tenantId, t.status),
    liftDateIdx: index('lift_plans_lift_date_idx').on(t.tenantId, t.liftDate),
    siteIdx: index('lift_plans_site_idx').on(t.tenantId, t.siteOrgUnitId),
    projectIdx: index('lift_plans_project_idx').on(t.tenantId, t.projectOrgUnitId),
    supervisorIdx: index('lift_plans_supervisor_idx').on(t.tenantId, t.supervisorTenantUserId),
  }),
)

// --- Loads -----------------------------------------------------------------
// One row per discrete item being lifted. Legacy stored a single `load_*`
// blob; we normalise so multi-piece lifts work.
export const liftPlanLoads = pgTable(
  'lift_plan_loads',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    liftPlanId: uuid('lift_plan_id')
      .notNull()
      .references(() => liftPlans.id, { onDelete: 'cascade' }),
    description: text('description').notNull(),
    weightKg: numeric('weight_kg', { precision: 12, scale: 2 }),
    dimensionsMaxMm: integer('dimensions_max_mm'),
    attachmentMethod: text('attachment_method'),
    entityOrder: integer('entity_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    planIdx: index('lift_plan_loads_plan_idx').on(t.liftPlanId, t.entityOrder),
    tenantIdx: index('lift_plan_loads_tenant_idx').on(t.tenantId),
  }),
)

// --- Equipment -------------------------------------------------------------
// One row per crane / lifting device. Either points to a tracked
// equipment_item or stores a free-text description (subcontractor crane,
// rental, etc). capacityUsedPct is the engineering-critical number.
export const liftPlanEquipment = pgTable(
  'lift_plan_equipment',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    liftPlanId: uuid('lift_plan_id')
      .notNull()
      .references(() => liftPlans.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').references(() => equipmentItems.id),
    equipmentDescription: text('equipment_description'),
    capacityKg: numeric('capacity_kg', { precision: 12, scale: 2 }),
    boomLengthM: numeric('boom_length_m', { precision: 8, scale: 2 }),
    radiusM: numeric('radius_m', { precision: 8, scale: 2 }),
    capacityUsedPct: numeric('capacity_used_pct', { precision: 6, scale: 2 }),
    entityOrder: integer('entity_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    planIdx: index('lift_plan_equipment_plan_idx').on(t.liftPlanId, t.entityOrder),
    tenantIdx: index('lift_plan_equipment_tenant_idx').on(t.tenantId),
    itemIdx: index('lift_plan_equipment_item_idx').on(t.tenantId, t.equipmentItemId),
  }),
)

// --- Hazards ---------------------------------------------------------------
export const liftPlanHazards = pgTable(
  'lift_plan_hazards',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    liftPlanId: uuid('lift_plan_id')
      .notNull()
      .references(() => liftPlans.id, { onDelete: 'cascade' }),
    hazardDescription: text('hazard_description').notNull(),
    controls: text('controls'),
    entityOrder: integer('entity_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    planIdx: index('lift_plan_hazards_plan_idx').on(t.liftPlanId, t.entityOrder),
    tenantIdx: index('lift_plan_hazards_tenant_idx').on(t.tenantId),
  }),
)

// --- PPE -------------------------------------------------------------------
// Per-plan required PPE list. Lighter than the global PPE module — this is
// the lift-specific PPE manifest you sign off on at pre-job.
export const liftPlanPpe = pgTable(
  'lift_plan_ppe',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    liftPlanId: uuid('lift_plan_id')
      .notNull()
      .references(() => liftPlans.id, { onDelete: 'cascade' }),
    ppeName: text('ppe_name').notNull(),
    required: boolean('required').default(true).notNull(),
    entityOrder: integer('entity_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    planIdx: index('lift_plan_ppe_plan_idx').on(t.liftPlanId, t.entityOrder),
    tenantIdx: index('lift_plan_ppe_tenant_idx').on(t.tenantId),
  }),
)

// --- Signatures ------------------------------------------------------------
// One signature per role (supervisor, operator, rigger, signaler, spotter).
// Either an internal person (FK) or a free-text external name. The
// signatureDataUrl is a PNG data URL captured client-side by SignaturePad.
export const liftPlanSignatures = pgTable(
  'lift_plan_signatures',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    liftPlanId: uuid('lift_plan_id')
      .notNull()
      .references(() => liftPlans.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => people.id),
    externalName: text('external_name'),
    role: liftPlanSignatureRole('role').notNull(),
    signatureDataUrl: text('signature_data_url'),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    planIdx: index('lift_plan_signatures_plan_idx').on(t.liftPlanId),
    tenantIdx: index('lift_plan_signatures_tenant_idx').on(t.tenantId),
  }),
)

// --- Photos ----------------------------------------------------------------
// Linking table: many attachments per plan with an optional caption.
export const liftPlanPhotos = pgTable(
  'lift_plan_photos',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    liftPlanId: uuid('lift_plan_id')
      .notNull()
      .references(() => liftPlans.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    planIdx: index('lift_plan_photos_plan_idx').on(t.liftPlanId),
    tenantIdx: index('lift_plan_photos_tenant_idx').on(t.tenantId),
  }),
)

// --- Relations -------------------------------------------------------------
export const liftPlansRelations = relations(liftPlans, ({ one, many }) => ({
  tenant: one(tenants, { fields: [liftPlans.tenantId], references: [tenants.id] }),
  project: one(orgUnits, {
    fields: [liftPlans.projectOrgUnitId],
    references: [orgUnits.id],
    relationName: 'liftPlanProject',
  }),
  site: one(orgUnits, {
    fields: [liftPlans.siteOrgUnitId],
    references: [orgUnits.id],
    relationName: 'liftPlanSite',
  }),
  supervisor: one(tenantUsers, {
    fields: [liftPlans.supervisorTenantUserId],
    references: [tenantUsers.id],
  }),
  operator: one(people, {
    fields: [liftPlans.operatorPersonId],
    references: [people.id],
    relationName: 'liftPlanOperator',
  }),
  rigger: one(people, {
    fields: [liftPlans.riggerPersonId],
    references: [people.id],
    relationName: 'liftPlanRigger',
  }),
  loads: many(liftPlanLoads),
  equipment: many(liftPlanEquipment),
  hazards: many(liftPlanHazards),
  ppe: many(liftPlanPpe),
  signatures: many(liftPlanSignatures),
  photos: many(liftPlanPhotos),
}))

export const liftPlanLoadsRelations = relations(liftPlanLoads, ({ one }) => ({
  liftPlan: one(liftPlans, { fields: [liftPlanLoads.liftPlanId], references: [liftPlans.id] }),
}))

export const liftPlanEquipmentRelations = relations(liftPlanEquipment, ({ one }) => ({
  liftPlan: one(liftPlans, {
    fields: [liftPlanEquipment.liftPlanId],
    references: [liftPlans.id],
  }),
  equipmentItem: one(equipmentItems, {
    fields: [liftPlanEquipment.equipmentItemId],
    references: [equipmentItems.id],
  }),
}))

export const liftPlanHazardsRelations = relations(liftPlanHazards, ({ one }) => ({
  liftPlan: one(liftPlans, { fields: [liftPlanHazards.liftPlanId], references: [liftPlans.id] }),
}))

export const liftPlanPpeRelations = relations(liftPlanPpe, ({ one }) => ({
  liftPlan: one(liftPlans, { fields: [liftPlanPpe.liftPlanId], references: [liftPlans.id] }),
}))

export const liftPlanSignaturesRelations = relations(liftPlanSignatures, ({ one }) => ({
  liftPlan: one(liftPlans, {
    fields: [liftPlanSignatures.liftPlanId],
    references: [liftPlans.id],
  }),
  person: one(people, { fields: [liftPlanSignatures.personId], references: [people.id] }),
}))

export const liftPlanPhotosRelations = relations(liftPlanPhotos, ({ one }) => ({
  liftPlan: one(liftPlans, { fields: [liftPlanPhotos.liftPlanId], references: [liftPlans.id] }),
}))
