// Truck log — per-truck per-day driving log: odometer in/out, kilometres,
// manpower count, hours-on-site. Drives the monthly billing summary report.

import { relations } from 'drizzle-orm'
import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { equipmentItems } from './equipment'
import { orgUnits, people } from './org'

export const truckLogEntries = pgTable(
  'truck_log_entries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    equipmentItemId: uuid('equipment_item_id')
      .notNull()
      .references(() => equipmentItems.id, { onDelete: 'cascade' }),
    entryDate: date('entry_date').notNull(),
    driverPersonId: uuid('driver_person_id').references(() => people.id),
    startOdometer: integer('start_odometer'),
    endOdometer: integer('end_odometer'),
    kmDriven: integer('km_driven'),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    hoursOnSite: numeric('hours_on_site', { precision: 6, scale: 2 }),
    manpowerCount: integer('manpower_count'),
    notes: text('notes'),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('truck_log_tenant_idx').on(t.tenantId),
    truckDateUx: uniqueIndex('truck_log_truck_date_ux').on(
      t.tenantId,
      t.equipmentItemId,
      t.entryDate,
    ),
    dateIdx: index('truck_log_date_idx').on(t.tenantId, t.entryDate),
    truckIdx: index('truck_log_truck_idx').on(t.equipmentItemId, t.entryDate),
    siteIdx: index('truck_log_site_idx').on(t.tenantId, t.siteOrgUnitId),
  }),
)

export const truckLogEntriesRelations = relations(truckLogEntries, ({ one }) => ({
  tenant: one(tenants, { fields: [truckLogEntries.tenantId], references: [tenants.id] }),
  truck: one(equipmentItems, {
    fields: [truckLogEntries.equipmentItemId],
    references: [equipmentItems.id],
  }),
  driver: one(people, {
    fields: [truckLogEntries.driverPersonId],
    references: [people.id],
  }),
  site: one(orgUnits, {
    fields: [truckLogEntries.siteOrgUnitId],
    references: [orgUnits.id],
  }),
}))
