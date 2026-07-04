// Equipment maintenance scheduling — the calendar side of the equipment module.
//
// equipment_inspection_schedules: per-unit recurring inspection cadences. One
// asset can carry any number of schedules ("Daily walkaround", "Every 3 months
// — hydraulics", "5-year structural") each with an arbitrary value + unit
// interval. Submitting an inspection of the matching type advances the
// schedule's last-completed / next-due dates. These rows drive the maintenance
// cockpit, compliance signals, and the upcoming-inspections report.
//
// equipment_reminders: ad-hoc, user-entered maintenance to-dos pinned to an
// asset ("check roof membrane in March"). One-off by default; an optional
// repeat interval re-spawns the next occurrence when the reminder is
// completed. Surfaced alongside schedules on the maintenance cockpit.

import { relations } from 'drizzle-orm'
import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { people } from './org'
import { equipmentItems } from './equipment'
import { equipmentIntervalUnit, equipmentInspectionTypes } from './equipment-inspection-types'

export const equipmentInspectionSchedules = pgTable(
  'equipment_inspection_schedules',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    // The checklist to perform. Nullable so a due-date-only schedule (e.g. a
    // third-party certification with no in-app checklist) can still be
    // tracked; `label` names it in that case.
    inspectionTypeId: uuid('inspection_type_id').references(() => equipmentInspectionTypes.id, {
      onDelete: 'set null',
    }),
    // Display name when there is no inspection type (or to override its name).
    label: text('label'),
    // "Every {intervalValue} {intervalUnit}s" — e.g. 1/day, 3/month, 5/year.
    intervalValue: integer('interval_value').notNull(),
    intervalUnit: equipmentIntervalUnit('interval_unit').notNull(),
    lastCompletedOn: date('last_completed_on'),
    nextDueOn: date('next_due_on').notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    notes: text('notes'),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    tenantDueIdx: index('equipment_inspection_schedules_tenant_due_idx').on(
      t.tenantId,
      t.nextDueOn,
    ),
    itemIdx: index('equipment_inspection_schedules_item_idx').on(t.equipmentItemId),
    typeIdx: index('equipment_inspection_schedules_type_idx').on(t.tenantId, t.inspectionTypeId),
  }),
)

export const equipmentReminders = pgTable(
  'equipment_reminders',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    details: text('details'),
    dueOn: date('due_on').notNull(),
    // When set, completing the reminder spawns the next occurrence dueOn +
    // interval (the completed row is kept as history).
    repeatIntervalValue: integer('repeat_interval_value'),
    repeatIntervalUnit: equipmentIntervalUnit('repeat_interval_unit'),
    assignedToPersonId: uuid('assigned_to_person_id').references(() => people.id, {
      onDelete: 'set null',
    }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByTenantUserId: uuid('completed_by_tenant_user_id').references(() => tenantUsers.id),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    tenantDueIdx: index('equipment_reminders_tenant_due_idx').on(t.tenantId, t.dueOn),
    itemIdx: index('equipment_reminders_item_idx').on(t.equipmentItemId),
    openIdx: index('equipment_reminders_open_idx').on(t.tenantId, t.completedAt),
  }),
)

export const equipmentInspectionSchedulesRelations = relations(
  equipmentInspectionSchedules,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [equipmentInspectionSchedules.tenantId],
      references: [tenants.id],
    }),
    item: one(equipmentItems, {
      fields: [equipmentInspectionSchedules.equipmentItemId],
      references: [equipmentItems.id],
    }),
    inspectionType: one(equipmentInspectionTypes, {
      fields: [equipmentInspectionSchedules.inspectionTypeId],
      references: [equipmentInspectionTypes.id],
    }),
  }),
)

export const equipmentRemindersRelations = relations(equipmentReminders, ({ one }) => ({
  tenant: one(tenants, { fields: [equipmentReminders.tenantId], references: [tenants.id] }),
  item: one(equipmentItems, {
    fields: [equipmentReminders.equipmentItemId],
    references: [equipmentItems.id],
  }),
  assignedTo: one(people, {
    fields: [equipmentReminders.assignedToPersonId],
    references: [people.id],
  }),
}))
