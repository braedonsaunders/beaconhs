// Provider-neutral tracker inventory and observations. Telemetry never owns
// equipment register fields or records a custody transfer.
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { equipmentItems } from './equipment'
import { syncConnections } from './sync'

export const equipmentTelemetryAssets = pgTable(
  'equipment_telemetry_assets',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull(),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    vin: text('vin'),
    deviceSerials: jsonb('device_serials').$type<string[]>().default([]).notNull(),
    deviceModels: jsonb('device_models').$type<string[]>().default([]).notNull(),
    itemId: uuid('item_id'),
    boundAt: timestamp('bound_at', { withTimezone: true }),
    excluded: boolean('excluded').default(false).notNull(),
    sourcePresent: boolean('source_present').default(true).notNull(),
    deactivated: boolean('deactivated').default(false).notNull(),
    lastReportedAt: timestamp('last_reported_at', { withTimezone: true }),
    gpsValid: boolean('gps_valid').default(false).notNull(),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    locationObservedAt: timestamp('location_observed_at', { withTimezone: true }),
    speedKph: doublePrecision('speed_kph'),
    engineOn: boolean('engine_on'),
    address: text('address'),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdIdUx: uniqueIndex('equipment_telemetry_assets_tenant_id_id_ux').on(t.tenantId, t.id),
    externalUx: uniqueIndex('equipment_telemetry_assets_external_ux').on(
      t.tenantId,
      t.connectionId,
      t.externalId,
    ),
    itemUx: uniqueIndex('equipment_telemetry_assets_item_ux')
      .on(t.tenantId, t.itemId)
      .where(sql`${t.itemId} IS NOT NULL`),
    tenantIdx: index('equipment_telemetry_assets_tenant_idx').on(t.tenantId, t.connectionId),
    coordinateCheck: check(
      'equipment_telemetry_assets_coordinate_ck',
      sql`(${t.latitude} IS NULL AND ${t.longitude} IS NULL AND ${t.locationObservedAt} IS NULL) OR (${t.latitude} IS NOT NULL AND ${t.longitude} IS NOT NULL AND ${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180 AND ${t.locationObservedAt} IS NOT NULL)`,
    ),
    bindingCheck: check(
      'equipment_telemetry_assets_binding_ck',
      sql`(${t.itemId} IS NULL AND ${t.boundAt} IS NULL) OR (${t.itemId} IS NOT NULL AND ${t.boundAt} IS NOT NULL AND NOT ${t.excluded})`,
    ),
    connectionFk: foreignKey({
      name: 'equipment_telemetry_assets_connection_fk',
      columns: [t.tenantId, t.connectionId],
      foreignColumns: [syncConnections.tenantId, syncConnections.id],
    }).onDelete('cascade'),
    itemFk: foreignKey({
      name: 'equipment_telemetry_assets_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }),
  }),
)

export const equipmentTelemetryObservations = pgTable(
  'equipment_telemetry_observations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    telemetryAssetId: uuid('telemetry_asset_id').notNull(),
    // Assignment at observation time; never rewritten when a tracker is moved.
    itemId: uuid('item_id'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    latitude: doublePrecision('latitude').notNull(),
    longitude: doublePrecision('longitude').notNull(),
    speedKph: doublePrecision('speed_kph'),
    engineOn: boolean('engine_on'),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    observationUx: uniqueIndex('equipment_telemetry_observations_source_ux').on(
      t.tenantId,
      t.telemetryAssetId,
      t.observedAt,
    ),
    itemIdx: index('equipment_telemetry_observations_item_idx').on(
      t.tenantId,
      t.itemId,
      t.observedAt,
    ),
    retentionIdx: index('equipment_telemetry_observations_retention_idx').on(t.observedAt),
    coordinateCheck: check(
      'equipment_telemetry_observations_coordinate_ck',
      sql`${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180`,
    ),
    assetFk: foreignKey({
      name: 'equipment_telemetry_observations_asset_fk',
      columns: [t.tenantId, t.telemetryAssetId],
      foreignColumns: [equipmentTelemetryAssets.tenantId, equipmentTelemetryAssets.id],
    }).onDelete('cascade'),
    itemFk: foreignKey({
      name: 'equipment_telemetry_observations_item_fk',
      columns: [t.tenantId, t.itemId],
      foreignColumns: [equipmentItems.tenantId, equipmentItems.id],
    }),
  }),
)
