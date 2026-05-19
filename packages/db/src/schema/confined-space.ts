// Confined Space permits + atmospheric readings.
// First-class because of permit lifecycle (open/closed/expired) and out-of-spec alarming.

import { relations } from 'drizzle-orm'
import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { orgUnits, people } from './org'

export const csPermitStatus = pgEnum('cs_permit_status', [
  'open',
  'active',
  'closed',
  'expired',
  'cancelled',
])

export const csPermits = pgTable(
  'cs_permits',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    title: text('title').notNull(),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    spaceDescription: text('space_description').notNull(),
    hazardIdentification: jsonb('hazard_identification').$type<string[]>().default([]).notNull(),
    rescuePlan: text('rescue_plan'),
    issuedByTenantUserId: uuid('issued_by_tenant_user_id').references(() => tenantUsers.id),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByTenantUserId: uuid('closed_by_tenant_user_id').references(() => tenantUsers.id),
    status: csPermitStatus('status').default('open').notNull(),
    attendantPersonIds: jsonb('attendant_person_ids').$type<string[]>().default([]).notNull(),
    entrantPersonIds: jsonb('entrant_person_ids').$type<string[]>().default([]).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('cs_permits_tenant_idx').on(t.tenantId),
    statusIdx: index('cs_permits_status_idx').on(t.tenantId, t.status),
    expiresIdx: index('cs_permits_expires_idx').on(t.tenantId, t.expiresAt),
  }),
)

export const csAtmosphericReadings = pgTable(
  'cs_atmospheric_readings',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    permitId: uuid('permit_id')
      .notNull()
      .references(() => csPermits.id, { onDelete: 'cascade' }),
    recordedByTenantUserId: uuid('recorded_by_tenant_user_id').references(() => tenantUsers.id),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    sensorIdentifier: text('sensor_identifier'),
    oxygenPct: doublePrecision('oxygen_pct'),
    lelPct: doublePrecision('lel_pct'),
    h2sPpm: doublePrecision('h2s_ppm'),
    coPpm: doublePrecision('co_ppm'),
    additionalReadings: jsonb('additional_readings').$type<Record<string, number>>(),
    outOfSpec: integer('out_of_spec_flag').default(0).notNull(), // 0 or 1; uses integer for partial index friendliness
    note: text('note'),
  },
  (t) => ({
    permitIdx: index('cs_atmospheric_readings_permit_idx').on(t.permitId, t.recordedAt),
    tenantIdx: index('cs_atmospheric_readings_tenant_idx').on(t.tenantId),
  }),
)

// Per-permit personnel log: entrants, attendants, supervisors, rescue.
// Tracks entry/exit timestamps for live attendance audit.
export const csPermitPersonnelRole = pgEnum('cs_permit_personnel_role', [
  'entrant',
  'attendant',
  'supervisor',
  'rescue',
])

export const csPermitPersonnel = pgTable(
  'cs_permit_personnel',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    permitId: uuid('permit_id')
      .notNull()
      .references(() => csPermits.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    role: csPermitPersonnelRole('role').notNull(),
    enteredAt: timestamp('entered_at', { withTimezone: true }),
    exitedAt: timestamp('exited_at', { withTimezone: true }),
    note: text('note'),
    ...timestamps,
  },
  (t) => ({
    permitIdx: index('cs_permit_personnel_permit_idx').on(t.permitId),
    personIdx: index('cs_permit_personnel_person_idx').on(t.tenantId, t.personId),
    tenantIdx: index('cs_permit_personnel_tenant_idx').on(t.tenantId),
  }),
)

export const csPermitsRelations = relations(csPermits, ({ one, many }) => ({
  tenant: one(tenants, { fields: [csPermits.tenantId], references: [tenants.id] }),
  readings: many(csAtmosphericReadings),
  personnel: many(csPermitPersonnel),
}))

export const csPermitPersonnelRelations = relations(csPermitPersonnel, ({ one }) => ({
  tenant: one(tenants, { fields: [csPermitPersonnel.tenantId], references: [tenants.id] }),
  permit: one(csPermits, { fields: [csPermitPersonnel.permitId], references: [csPermits.id] }),
  person: one(people, { fields: [csPermitPersonnel.personId], references: [people.id] }),
}))
