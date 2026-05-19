// Equipment inspection types — per-equipment-type inspection templates with
// pass/fail criteria. Distinct from the generic inspection_banks (which back
// arbitrary form templates): these are pinned to an equipment_type and carry
// an interval (daily / monthly / annual / 5-year) so the upcoming-inspections
// report can compute next-due dates without a separate calendar.
//
// On a failed criterion the calling code spawns an equipment_work_order
// automatically — same behaviour as the legacy app's "fail = WO" rule.

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { equipmentTypes } from './equipment'

export const equipmentInspectionInterval = pgEnum('equipment_inspection_interval', [
  'pre_use',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'annually',
  'five_year',
  'on_demand',
])

export const equipmentInspectionTypes = pgTable(
  'equipment_inspection_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // When set, this template is meant for items of a specific equipment_type
    // (e.g. "Pickup truck — Annual safety"). When null, the template is
    // generic and can be applied to any item.
    appliesToTypeId: uuid('applies_to_type_id').references(() => equipmentTypes.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    interval: equipmentInspectionInterval('interval').default('on_demand').notNull(),
    // When true, the "pass all" shortcut button is available in the runtime
    // form. Defaults true to match legacy behaviour.
    allowPassAll: boolean('allow_pass_all').default(true).notNull(),
    // When true, a failed criterion auto-creates a work order against the
    // equipment item being inspected.
    failsSpawnWorkOrders: boolean('fails_spawn_work_orders').default(true).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_inspection_types_tenant_idx').on(t.tenantId),
    appliesToIdx: index('equipment_inspection_types_applies_idx').on(t.tenantId, t.appliesToTypeId),
  }),
)

export const equipmentInspectionCriterionKind = pgEnum('equipment_inspection_criterion_kind', [
  'pass_fail',
  'pass_fail_na',
  'text',
  'numeric',
  'photo',
])

export const equipmentInspectionCriterionSeverity = pgEnum(
  'equipment_inspection_criterion_severity',
  ['low', 'medium', 'high', 'critical'],
)

export const equipmentInspectionCriteria = pgTable(
  'equipment_inspection_criteria',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    inspectionTypeId: uuid('inspection_type_id')
      .notNull()
      .references(() => equipmentInspectionTypes.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    question: text('question').notNull(),
    description: text('description'),
    kind: equipmentInspectionCriterionKind('kind').default('pass_fail').notNull(),
    severity: equipmentInspectionCriterionSeverity('severity').default('medium').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    requiresComment: boolean('requires_comment').default(false).notNull(),
    // When true, a failing answer is treated as a critical defect (red flag
    // on the report and forced WO creation regardless of the template-level
    // `failsSpawnWorkOrders` setting).
    isCritical: boolean('is_critical').default(false).notNull(),
    ...timestamps,
  },
  (t) => ({
    typeSeqIdx: index('equipment_inspection_criteria_type_seq_idx').on(
      t.inspectionTypeId,
      t.sequence,
    ),
    tenantIdx: index('equipment_inspection_criteria_tenant_idx').on(t.tenantId),
  }),
)

export const equipmentInspectionTypesRelations = relations(
  equipmentInspectionTypes,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [equipmentInspectionTypes.tenantId],
      references: [tenants.id],
    }),
    appliesTo: one(equipmentTypes, {
      fields: [equipmentInspectionTypes.appliesToTypeId],
      references: [equipmentTypes.id],
    }),
    criteria: many(equipmentInspectionCriteria),
  }),
)

export const equipmentInspectionCriteriaRelations = relations(
  equipmentInspectionCriteria,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [equipmentInspectionCriteria.tenantId],
      references: [tenants.id],
    }),
    type: one(equipmentInspectionTypes, {
      fields: [equipmentInspectionCriteria.inspectionTypeId],
      references: [equipmentInspectionTypes.id],
    }),
  }),
)
