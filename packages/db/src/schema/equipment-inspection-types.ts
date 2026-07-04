// Equipment inspection types — per-equipment-type inspection templates with
// pass/fail criteria. Distinct from the generic inspection_banks (which back
// arbitrary form templates): these are pinned to an equipment_type and carry
// a default cadence (any value + unit, e.g. every 3 months or every 5 years).
// Per-unit cadences live in equipment_inspection_schedules, which override the
// type default for a specific asset.
//
// On a failed criterion the calling code spawns an equipment_work_order
// automatically — same behaviour as the legacy app's "fail = WO" rule.
//
// Criteria can be grouped into sections (equipment_inspection_groups) so the
// 1/3-2/3 builder mirrors the PPE + inspection type builders exactly.

import { relations } from 'drizzle-orm'
import { boolean, index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { equipmentTypes } from './equipment'

// Unit for equipment maintenance cadences ("every N days/weeks/months/years").
// Shared by inspection-type defaults, per-unit inspection schedules, and
// repeating ad-hoc reminders.
export const equipmentIntervalUnit = pgEnum('equipment_interval_unit', [
  'day',
  'week',
  'month',
  'year',
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
    // Default cadence for this template: "every {intervalValue} {intervalUnit}s".
    // Both null = on demand (no recurring schedule). A per-unit
    // equipment_inspection_schedules row can override this for one asset.
    intervalValue: integer('interval_value'),
    intervalUnit: equipmentIntervalUnit('interval_unit'),
    // Pre-use templates are gated by the item's requiresPreUseInspection flag
    // rather than a calendar; submitting one stamps lastPreUseInspectionAt.
    isPreUse: boolean('is_pre_use').default(false).notNull(),
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

// Sections inside a type's checklist (e.g. "Engine bay", "Cab", "Hydraulics").
// Mirrors inspection_type_groups so the 1/3-2/3 builder can drag-reorder
// sections and bucket criteria. A criterion with group_id = null is "ungrouped"
// and renders in a trailing catch-all section.
export const equipmentInspectionGroups = pgTable(
  'equipment_inspection_groups',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    inspectionTypeId: uuid('inspection_type_id')
      .notNull()
      .references(() => equipmentInspectionTypes.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').default(0).notNull(),
    label: text('label').notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('equipment_inspection_groups_tenant_idx').on(t.tenantId),
    typeSeqIdx: index('equipment_inspection_groups_type_seq_idx').on(
      t.inspectionTypeId,
      t.sequence,
    ),
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
    // Section this criterion belongs to; null = ungrouped (catch-all section).
    groupId: uuid('group_id').references(() => equipmentInspectionGroups.id, {
      onDelete: 'set null',
    }),
    sequence: integer('sequence').notNull(),
    question: text('question').notNull(),
    description: text('description'),
    kind: equipmentInspectionCriterionKind('kind').default('pass_fail').notNull(),
    severity: equipmentInspectionCriterionSeverity('severity').default('medium').notNull(),
    requiresPhoto: boolean('requires_photo').default(false).notNull(),
    requiresComment: boolean('requires_comment').default(false).notNull(),
    // When true, the runtime form must collect an answer (no skip / leave-
    // blank). Most inspections have all-required criteria; the flag exists so
    // optional questions can coexist with mandatory ones inside one template.
    isRequired: boolean('is_required').default(true).notNull(),
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
    groupIdx: index('equipment_inspection_criteria_group_idx').on(t.groupId),
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
    groups: many(equipmentInspectionGroups),
    criteria: many(equipmentInspectionCriteria),
  }),
)

export const equipmentInspectionGroupsRelations = relations(
  equipmentInspectionGroups,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [equipmentInspectionGroups.tenantId],
      references: [tenants.id],
    }),
    type: one(equipmentInspectionTypes, {
      fields: [equipmentInspectionGroups.inspectionTypeId],
      references: [equipmentInspectionTypes.id],
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
    group: one(equipmentInspectionGroups, {
      fields: [equipmentInspectionCriteria.groupId],
      references: [equipmentInspectionGroups.id],
    }),
  }),
)
