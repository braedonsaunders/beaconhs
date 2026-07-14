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

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { durablePublication, id, timestamps } from './_helpers'
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
    equipmentItemId: uuid('equipment_item_id').notNull(),
    // The checklist to perform. Nullable so a due-date-only schedule (e.g. a
    // third-party certification with no in-app checklist) can still be
    // tracked; `label` names it in that case.
    inspectionTypeId: uuid('inspection_type_id'),
    // Display name when there is no inspection type (or to override its name).
    label: text('label'),
    // "Every {intervalValue} {intervalUnit}s" — e.g. 1/day, 3/month, 5/year.
    intervalValue: integer('interval_value').notNull(),
    intervalUnit: equipmentIntervalUnit('interval_unit').notNull(),
    lastCompletedOn: date('last_completed_on'),
    nextDueOn: date('next_due_on').notNull(),
    // The nextDueOn value the maintenance scan last notified about — a
    // schedule alerts once per due cycle (stamp ≠ nextDueOn), not on every
    // scan while it sits overdue. Advancing the schedule re-arms it.
    dueNotifiedFor: date('due_notified_for'),
    isActive: boolean('is_active').default(true).notNull(),
    notes: text('notes'),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    ...timestamps,
  },
  (t) => ({
    tenantDueIdx: index('equipment_inspection_schedules_tenant_due_idx').on(
      t.tenantId,
      t.nextDueOn,
    ),
    itemIdx: index('equipment_inspection_schedules_item_idx').on(t.tenantId, t.equipmentItemId),
    typeIdx: index('equipment_inspection_schedules_type_idx').on(t.tenantId, t.inspectionTypeId),
    createdByIdx: index('equipment_inspection_schedules_created_by_idx').on(
      t.tenantId,
      t.createdByTenantUserId,
    ),
    itemFk: foreignKey({
      name: 'equipment_inspection_schedules_tenant_item_fk',
      columns: [t.tenantId, t.equipmentItemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }).onDelete('cascade'),
    createdByFk: foreignKey({
      name: 'equipment_inspection_schedules_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const equipmentReminders = pgTable(
  'equipment_reminders',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id').notNull(),
    title: text('title').notNull(),
    details: text('details'),
    dueOn: date('due_on').notNull(),
    // When set, completing the reminder spawns the next occurrence dueOn +
    // interval (the completed row is kept as history).
    repeatIntervalValue: integer('repeat_interval_value'),
    repeatIntervalUnit: equipmentIntervalUnit('repeat_interval_unit'),
    // The dueOn value the maintenance scan last notified about (see the same
    // stamp on schedules). Editing the due date re-arms the alert; a repeat
    // spawns a fresh row, so each occurrence alerts once.
    dueNotifiedFor: date('due_notified_for'),
    assignedToPersonId: uuid('assigned_to_person_id'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedByTenantUserId: uuid('completed_by_tenant_user_id'),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    ...timestamps,
  },
  (t) => ({
    tenantDueIdx: index('equipment_reminders_tenant_due_idx').on(t.tenantId, t.dueOn),
    itemIdx: index('equipment_reminders_item_idx').on(t.tenantId, t.equipmentItemId),
    openIdx: index('equipment_reminders_open_idx').on(t.tenantId, t.completedAt),
    assignedToIdx: index('equipment_reminders_assigned_to_idx').on(
      t.tenantId,
      t.assignedToPersonId,
    ),
    completedByIdx: index('equipment_reminders_completed_by_idx').on(
      t.tenantId,
      t.completedByTenantUserId,
    ),
    createdByIdx: index('equipment_reminders_created_by_idx').on(
      t.tenantId,
      t.createdByTenantUserId,
    ),
    itemFk: foreignKey({
      name: 'equipment_reminders_tenant_item_fk',
      columns: [t.tenantId, t.equipmentItemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }).onDelete('cascade'),
    completedByFk: foreignKey({
      name: 'equipment_reminders_tenant_completed_by_fk',
      columns: [t.tenantId, t.completedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    createdByFk: foreignKey({
      name: 'equipment_reminders_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const equipmentMaintenanceDispatchStatus = pgEnum('equipment_maintenance_dispatch_status', [
  'queued',
  'enqueued',
  'failed',
])

export const equipmentMaintenanceDispatches = pgTable(
  'equipment_maintenance_dispatches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    deliveryKey: text('delivery_key').notNull(),
    status: equipmentMaintenanceDispatchStatus('status').default('queued').notNull(),
    entries: jsonb('entries')
      .$type<
        Array<{
          kind: 'inspection' | 'reminder'
          equipmentItemId: string
          itemName: string
          assetTag: string
          title: string
          dueOn: string
          assigneePersonId?: string | null
        }>
      >()
      .notNull(),
    scheduleCycles: jsonb('schedule_cycles')
      .$type<Array<{ id: string; dueOn: string }>>()
      .default([])
      .notNull(),
    reminderCycles: jsonb('reminder_cycles')
      .$type<Array<{ id: string; dueOn: string }>>()
      .default([])
      .notNull(),
    error: text('error'),
    ...durablePublication,
    ...timestamps,
  },
  (t) => ({
    tenantStatusIdx: index('equipment_maintenance_dispatches_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
    tenantDeliveryUx: uniqueIndex('equipment_maintenance_dispatches_tenant_delivery_ux').on(
      t.tenantId,
      t.deliveryKey,
    ),
    publishAvailableIdx: index('equipment_maintenance_dispatches_publish_available_idx').on(
      t.status,
      t.publishAvailableAt,
    ),
    publishClaimedIdx: index('equipment_maintenance_dispatches_publish_claimed_idx').on(
      t.status,
      t.publishClaimedAt,
    ),
    publishAttemptsCheck: check(
      'equipment_maintenance_dispatches_publish_attempts_ck',
      sql`${t.publishAttempts} >= 0`,
    ),
    publishLeaseStateCheck: check(
      'equipment_maintenance_dispatches_publish_lease_state_ck',
      sql`(
        (${t.status} = 'queued' AND (
          (${t.publishLeaseId} IS NULL AND ${t.publishClaimedAt} IS NULL)
          OR
          (${t.publishLeaseId} IS NOT NULL AND ${t.publishClaimedAt} IS NOT NULL)
        ))
        OR
        (${t.status} <> 'queued' AND ${t.publishLeaseId} IS NULL AND ${t.publishClaimedAt} IS NULL)
      )`,
    ),
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
      fields: [equipmentInspectionSchedules.tenantId, equipmentInspectionSchedules.equipmentItemId],
      references: [equipmentItems.tenantId, equipmentItems.id],
    }),
    inspectionType: one(equipmentInspectionTypes, {
      fields: [
        equipmentInspectionSchedules.tenantId,
        equipmentInspectionSchedules.inspectionTypeId,
      ],
      references: [equipmentInspectionTypes.tenantId, equipmentInspectionTypes.id],
    }),
  }),
)

export const equipmentRemindersRelations = relations(equipmentReminders, ({ one }) => ({
  tenant: one(tenants, { fields: [equipmentReminders.tenantId], references: [tenants.id] }),
  item: one(equipmentItems, {
    fields: [equipmentReminders.tenantId, equipmentReminders.equipmentItemId],
    references: [equipmentItems.tenantId, equipmentItems.id],
  }),
  assignedTo: one(people, {
    fields: [equipmentReminders.tenantId, equipmentReminders.assignedToPersonId],
    references: [people.tenantId, people.id],
  }),
}))
