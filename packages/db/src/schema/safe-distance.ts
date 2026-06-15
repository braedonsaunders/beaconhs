// Safe Distance — pneumatic pressure-test stored-energy standoff calculator.
//
// Replaces the legacy beaconhs tool. Computes the minimum safe distance for
// personnel during a pneumatic (compressed-gas) pressure test of a piping
// system, where the stored energy released on failure is an explosion hazard.
//
// Three industry methods are computed for every record:
//   - nasa   — NASA-Glenn Research Safety Manual stand-off table
//   - asme   — ASME PCC-2 Article 5.1 stored-energy / TNT-equivalent
//   - lloyds — Lloyd's Register form T-0240 S4.3
// The operator picks which method governs (`method`); all three are stored so
// the PDF can show the full comparison. The formulas live in
// `apps/web/src/app/(app)/tools/safe-distance/_lib.ts`.
//
// One parent record per assessment; one child row per pipe segment. Total
// system volume = Σ segment volumes (π·(d/2)²·L). Reference is auto-generated
// SD-YYYY-NNNN per tenant per year. Locking + audit mirror corrective-actions.

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { orgUnits, people } from './org'

// Which standard governs the record. All three are always computed.
export const safeDistanceMethod = pgEnum('safe_distance_method', ['nasa', 'asme', 'lloyds'])
// Result unit system: metric → bar / m³ / m, imperial → psi / ft³ / ft.
export const safeDistanceUnit = pgEnum('safe_distance_unit', ['metric', 'imperial'])
// Per-segment length/diameter unit. Stored per row so a system can mix units;
// volume is always normalised to m³ at compute time.
export const safeDistanceSegmentUnit = pgEnum('safe_distance_segment_unit', [
  'inch',
  'feet',
  'mm',
  'cm',
  'm',
])

export const safeDistanceRecords = pgTable(
  'safe_distance_records',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // SD-YYYY-NNNN

    name: text('name').default('Pressure test').notNull(),
    method: safeDistanceMethod('method').default('nasa').notNull(),
    unit: safeDistanceUnit('unit').default('imperial').notNull(),
    // Test pressure expressed in the record's unit system: psi (imperial) or
    // bar (metric). Converted to all needed units at compute time.
    testPressure: numeric('test_pressure', { precision: 12, scale: 4 }).default('0').notNull(),
    description: text('description'),

    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    supervisorTenantUserId: uuid('supervisor_tenant_user_id').references(() => tenantUsers.id),
    operatorPersonId: uuid('operator_person_id').references(() => people.id),

    // Computed + persisted on save (server-authoritative). Volume + all three
    // method results are stored in the record's display unit (ft³/ft for
    // imperial, m³/m for metric).
    totalVolume: numeric('total_volume', { precision: 16, scale: 6 }).default('0').notNull(),
    resultNasa: numeric('result_nasa', { precision: 12, scale: 4 }).default('0').notNull(),
    resultAsme: numeric('result_asme', { precision: 12, scale: 4 }).default('0').notNull(),
    resultLloyds: numeric('result_lloyds', { precision: 12, scale: 4 }).default('0').notNull(),

    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    notes: text('notes'),
    attachmentIds: jsonb('attachment_ids').$type<string[]>().default([]).notNull(),

    locked: boolean('locked').default(false).notNull(),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('safe_distance_records_tenant_idx').on(t.tenantId),
    tenantReferenceUx: uniqueIndex('safe_distance_records_tenant_ref_ux').on(
      t.tenantId,
      t.reference,
    ),
    methodIdx: index('safe_distance_records_method_idx').on(t.tenantId, t.method),
    siteIdx: index('safe_distance_records_site_idx').on(t.tenantId, t.siteOrgUnitId),
    occurredIdx: index('safe_distance_records_occurred_idx').on(t.tenantId, t.occurredAt),
  }),
)

// One pipe segment of the system under test. Volume = π·(d/2)²·L, normalised to
// m³ and persisted for cheap roll-ups.
export const safeDistanceSegments = pgTable(
  'safe_distance_segments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => safeDistanceRecords.id, { onDelete: 'cascade' }),
    name: text('name'),
    unit: safeDistanceSegmentUnit('unit').default('inch').notNull(),
    lengthValue: numeric('length_value', { precision: 16, scale: 6 }).default('0').notNull(),
    internalDiameter: numeric('internal_diameter', { precision: 16, scale: 6 })
      .default('0')
      .notNull(),
    volumeM3: numeric('volume_m3', { precision: 18, scale: 9 }).default('0').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    recordIdx: index('safe_distance_segments_record_idx').on(t.recordId, t.sortOrder),
    tenantIdx: index('safe_distance_segments_tenant_idx').on(t.tenantId),
  }),
)

export const safeDistanceRecordsRelations = relations(safeDistanceRecords, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [safeDistanceRecords.tenantId],
    references: [tenants.id],
  }),
  site: one(orgUnits, {
    fields: [safeDistanceRecords.siteOrgUnitId],
    references: [orgUnits.id],
  }),
  supervisor: one(tenantUsers, {
    fields: [safeDistanceRecords.supervisorTenantUserId],
    references: [tenantUsers.id],
  }),
  operator: one(people, {
    fields: [safeDistanceRecords.operatorPersonId],
    references: [people.id],
  }),
  segments: many(safeDistanceSegments),
}))

export const safeDistanceSegmentsRelations = relations(safeDistanceSegments, ({ one }) => ({
  record: one(safeDistanceRecords, {
    fields: [safeDistanceSegments.recordId],
    references: [safeDistanceRecords.id],
  }),
}))
