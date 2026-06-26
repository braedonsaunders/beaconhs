// Truck log — per-driver per-vehicle daily log: odometer in/out, kilometres,
// crew count, hours-on-site. Drives the monthly billing summary report.

import { relations } from 'drizzle-orm'
import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { equipmentItems } from './equipment'
import { orgUnits, people } from './org'
import { syncConnections } from './sync'

export type TruckLogEntryMode = 'destination' | 'odometer'
export type TruckLogImportStatus = 'manual' | 'suggested' | 'imported' | 'conflict'

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
    driverPersonId: uuid('driver_person_id')
      .notNull()
      .references(() => people.id),
    entryMode: text('entry_mode').$type<TruckLogEntryMode>().default('destination').notNull(),
    startOdometer: integer('start_odometer'),
    endOdometer: integer('end_odometer'),
    kmDriven: integer('km_driven'),
    businessKm: integer('business_km'),
    personalKm: integer('personal_km'),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    otherDestination: text('other_destination'),
    hoursOnSite: numeric('hours_on_site', { precision: 6, scale: 2 }),
    manpowerCount: integer('manpower_count'),
    notes: text('notes'),
    sourceConnectionId: uuid('source_connection_id').references(() => syncConnections.id, {
      onDelete: 'set null',
    }),
    sourceExternalId: text('source_external_id'),
    importStatus: text('import_status').$type<TruckLogImportStatus>().default('manual').notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }),
    importMeta: jsonb('import_meta').$type<Record<string, unknown>>().default({}).notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('truck_log_tenant_idx').on(t.tenantId),
    truckDateUx: uniqueIndex('truck_log_truck_date_ux').on(
      t.tenantId,
      t.equipmentItemId,
      t.driverPersonId,
      t.entryDate,
    ),
    dateIdx: index('truck_log_date_idx').on(t.tenantId, t.entryDate),
    truckIdx: index('truck_log_truck_idx').on(t.equipmentItemId, t.entryDate),
    driverDateIdx: index('truck_log_driver_date_idx').on(t.tenantId, t.driverPersonId, t.entryDate),
    siteIdx: index('truck_log_site_idx').on(t.tenantId, t.siteOrgUnitId),
    importIdx: index('truck_log_import_idx').on(t.tenantId, t.sourceConnectionId, t.importStatus),
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
