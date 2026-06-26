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

// Generic imported work/activity facts. These are source-neutral staging rows
// from SQL/CSV/Nango/custom connectors; vehicle logs can consume them, but the
// app never knows or cares whether the upstream system was a legacy labour
// table, payroll, dispatch, ERP, or a tenant-specific feed.
export const workActivityEntries = pgTable(
  'work_activity_entries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceConnectionId: uuid('source_connection_id')
      .notNull()
      .references(() => syncConnections.id, { onDelete: 'cascade' }),
    sourceSystem: text('source_system').notNull(),
    sourceExternalId: text('source_external_id').notNull(),
    activityDate: date('activity_date').notNull(),
    personId: uuid('person_id').references(() => people.id),
    externalEmployeeId: text('external_employee_id'),
    employeeNo: text('employee_no'),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    siteCode: text('site_code'),
    siteName: text('site_name'),
    sourceCode: text('source_code'),
    sourceLabel: text('source_label'),
    hours: numeric('hours', { precision: 8, scale: 2 }),
    businessKm: integer('business_km'),
    personalKm: integer('personal_km'),
    description: text('description'),
    status: text('status').default('ready').notNull(),
    raw: jsonb('raw').$type<Record<string, unknown>>().default({}).notNull(),
    importedAt: timestamp('imported_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('work_activity_tenant_idx').on(t.tenantId),
    dateIdx: index('work_activity_date_idx').on(t.tenantId, t.activityDate),
    personDateIdx: index('work_activity_person_date_idx').on(
      t.tenantId,
      t.personId,
      t.activityDate,
    ),
    siteIdx: index('work_activity_site_idx').on(t.tenantId, t.siteOrgUnitId),
    sourceUx: uniqueIndex('work_activity_source_ux').on(
      t.tenantId,
      t.sourceConnectionId,
      t.sourceExternalId,
    ),
  }),
)

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
    sourceWorkActivityId: uuid('source_work_activity_id').references(() => workActivityEntries.id, {
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

export const workActivityEntriesRelations = relations(workActivityEntries, ({ one }) => ({
  tenant: one(tenants, { fields: [workActivityEntries.tenantId], references: [tenants.id] }),
  sourceConnection: one(syncConnections, {
    fields: [workActivityEntries.sourceConnectionId],
    references: [syncConnections.id],
  }),
  person: one(people, {
    fields: [workActivityEntries.personId],
    references: [people.id],
  }),
  site: one(orgUnits, {
    fields: [workActivityEntries.siteOrgUnitId],
    references: [orgUnits.id],
  }),
}))

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
  sourceWorkActivity: one(workActivityEntries, {
    fields: [truckLogEntries.sourceWorkActivityId],
    references: [workActivityEntries.id],
  }),
}))
