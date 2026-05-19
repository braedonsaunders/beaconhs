// Atmospheric gas sensors — multi-gas / 4-gas / single-gas monitors used
// for confined-space entry. Tracks calibration history so we can flag
// sensors past their calibration window before they're issued.

import { relations } from 'drizzle-orm'
import { date, index, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants, tenantUsers } from './core'

export const atmosphericSensorType = pgEnum('atmospheric_sensor_type', [
  'multi_gas',
  '4_gas',
  'single_gas',
])

export const atmosphericSensorStatus = pgEnum('atmospheric_sensor_status', [
  'active',
  'out_of_service',
  'retired',
])

export const atmosphericSensors = pgTable(
  'atmospheric_sensors',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    identifier: text('identifier').notNull(), // tenant-unique label, e.g. 'GASMON-04'
    make: text('make'),
    model: text('model'),
    serialNumber: text('serial_number'),
    type: atmosphericSensorType('type').notNull(),
    gases: jsonb('gases').$type<string[]>().default([]).notNull(),
    lastCalibrationOn: date('last_calibration_on'),
    nextCalibrationDue: date('next_calibration_due'),
    status: atmosphericSensorStatus('status').default('active').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('atmospheric_sensors_tenant_idx').on(t.tenantId),
    tenantIdentifierUx: uniqueIndex('atmospheric_sensors_tenant_identifier_ux').on(
      t.tenantId,
      t.identifier,
    ),
    nextDueIdx: index('atmospheric_sensors_next_due_idx').on(t.tenantId, t.nextCalibrationDue),
  }),
)

export const atmosphericCalibrations = pgTable(
  'atmospheric_calibrations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sensorId: uuid('sensor_id')
      .notNull()
      .references(() => atmosphericSensors.id, { onDelete: 'cascade' }),
    calibratedOn: date('calibrated_on').notNull(),
    calibratedByTenantUserId: uuid('calibrated_by_tenant_user_id').references(() => tenantUsers.id),
    notes: text('notes'),
    certificateAttachmentId: uuid('certificate_attachment_id').references(() => attachments.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('atmospheric_calibrations_tenant_idx').on(t.tenantId),
    sensorDateIdx: index('atmospheric_calibrations_sensor_date_idx').on(
      t.sensorId,
      t.calibratedOn,
    ),
  }),
)

export const atmosphericSensorsRelations = relations(atmosphericSensors, ({ one, many }) => ({
  tenant: one(tenants, { fields: [atmosphericSensors.tenantId], references: [tenants.id] }),
  calibrations: many(atmosphericCalibrations),
}))

export const atmosphericCalibrationsRelations = relations(atmosphericCalibrations, ({ one }) => ({
  tenant: one(tenants, { fields: [atmosphericCalibrations.tenantId], references: [tenants.id] }),
  sensor: one(atmosphericSensors, {
    fields: [atmosphericCalibrations.sensorId],
    references: [atmosphericSensors.id],
  }),
  calibratedBy: one(tenantUsers, {
    fields: [atmosphericCalibrations.calibratedByTenantUserId],
    references: [tenantUsers.id],
  }),
  certificate: one(attachments, {
    fields: [atmosphericCalibrations.certificateAttachmentId],
    references: [attachments.id],
  }),
}))
