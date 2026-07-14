// Per-type catalog of pass/fail inspection criteria.
//
// Each `ppe_type` (e.g. "Full-body harness") owns an ordered list of yes/no
// criteria that an inspector runs through whenever they record a pre-use or
// annual inspection on an item of that type. Severity drives auto-CA escalation
// on `fail`; `requiresPhoto` forces the inspector to attach evidence.
//
// Criteria are organised into kind-scoped sections (`ppe_type_criteria_groups`)
// so the type builder mirrors the inspections module: drag-reorderable sections
// plus an "Import from bank" path that snapshots a criteria bank in as a new
// section. A criterion with `group_id = null` is "Ungrouped" and still renders.
//
// Legacy parity (app/Models/PPETypeRecord.php → table PPETYPESRECORDS):
//   PPETypeID, Criteria, Description, EntityOrder, Type ('PreUse' | 'Annual')
//
// We split the legacy Type column into a dedicated enum and add the modern
// `severity` + `requires_photo` columns so the inspection flow can mirror the
// inspections module exactly.

import { relations } from 'drizzle-orm'
import {
  boolean,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { ppeCriterionSeverity, ppeTypes } from './ppe'

export const ppeCriterionInspectionKind = pgEnum('ppe_criterion_inspection_kind', [
  'pre_use',
  'annual',
])

// A kind-scoped section within a PPE type's checklist. Pre-use and annual each
// keep their own sections so the two checklists stay cleanly separated in the
// builder. Deleting a section orphans its criteria back to "Ungrouped".
export const ppeTypeCriteriaGroups = pgTable(
  'ppe_type_criteria_groups',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ppeTypeId: uuid('ppe_type_id').notNull(),
    inspectionKind: ppeCriterionInspectionKind('inspection_kind').notNull().default('pre_use'),
    label: text('label').notNull(),
    sequence: integer('sequence').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_type_criteria_groups_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('ppe_type_criteria_groups_tenant_id_id_ux').on(t.tenantId, t.id),
    typeIdx: index('ppe_type_criteria_groups_type_idx').on(
      t.tenantId,
      t.ppeTypeId,
      t.inspectionKind,
      t.sequence,
    ),
    ppeTypeFk: foreignKey({
      name: 'ppe_type_criteria_groups_tenant_type_fk',
      columns: [t.tenantId, t.ppeTypeId],
      foreignColumns: [ppeTypes.tenantId, ppeTypes.id],
    }).onDelete('cascade'),
  }),
)

export const ppeTypeInspectionCriteria = pgTable(
  'ppe_type_inspection_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ppeTypeId: uuid('ppe_type_id').notNull(),
    // Optional kind-scoped section. Null = "Ungrouped". Set null on group delete
    // so the criterion survives and resurfaces in the ungrouped bucket.
    groupId: uuid('group_id'),
    inspectionKind: ppeCriterionInspectionKind('inspection_kind').notNull().default('pre_use'),
    question: text('question').notNull(),
    description: text('description'),
    severity: ppeCriterionSeverity('severity').default('medium').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    entityOrder: integer('entity_order').default(0).notNull(),
    // Soft provenance when copied in from a bank (no FK — mirrors inspections).
    sourceBankId: uuid('source_bank_id'),
    sourceBankCriterionId: uuid('source_bank_criterion_id'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('ppe_type_inspection_criteria_tenant_idx').on(t.tenantId),
    typeIdx: index('ppe_type_inspection_criteria_type_idx').on(
      t.tenantId,
      t.ppeTypeId,
      t.inspectionKind,
      t.entityOrder,
    ),
    groupIdx: index('ppe_type_inspection_criteria_group_idx').on(t.tenantId, t.groupId),
    ppeTypeFk: foreignKey({
      name: 'ppe_type_inspection_criteria_tenant_type_fk',
      columns: [t.tenantId, t.ppeTypeId],
      foreignColumns: [ppeTypes.tenantId, ppeTypes.id],
    }).onDelete('cascade'),
    groupFk: foreignKey({
      name: 'ppe_type_inspection_criteria_tenant_group_fk',
      columns: [t.tenantId, t.groupId],
      foreignColumns: [ppeTypeCriteriaGroups.tenantId, ppeTypeCriteriaGroups.id],
    }),
  }),
)

export const ppeTypeCriteriaGroupsRelations = relations(ppeTypeCriteriaGroups, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [ppeTypeCriteriaGroups.tenantId],
    references: [tenants.id],
  }),
  ppeType: one(ppeTypes, {
    fields: [ppeTypeCriteriaGroups.tenantId, ppeTypeCriteriaGroups.ppeTypeId],
    references: [ppeTypes.tenantId, ppeTypes.id],
  }),
  criteria: many(ppeTypeInspectionCriteria),
}))

export const ppeTypeInspectionCriteriaRelations = relations(
  ppeTypeInspectionCriteria,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [ppeTypeInspectionCriteria.tenantId],
      references: [tenants.id],
    }),
    ppeType: one(ppeTypes, {
      fields: [ppeTypeInspectionCriteria.tenantId, ppeTypeInspectionCriteria.ppeTypeId],
      references: [ppeTypes.tenantId, ppeTypes.id],
    }),
    group: one(ppeTypeCriteriaGroups, {
      fields: [ppeTypeInspectionCriteria.tenantId, ppeTypeInspectionCriteria.groupId],
      references: [ppeTypeCriteriaGroups.tenantId, ppeTypeCriteriaGroups.id],
    }),
  }),
)
