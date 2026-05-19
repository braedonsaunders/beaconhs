// Safe Distance — engineering calc + record-keeping for safe-distance
// assessments. Covers:
//   - electrical proximity (IEEE/CSA limits of approach)
//   - drone clearances from people
//   - overhead-crane to energised conductor
//   - vehicle proximity
//
// One record per assessment. The required distance is computed at write time
// using the lookup table in `apps/web/src/app/(app)/tools/safe-distance/_lib.ts`
// and the `complies` flag is whether actualDistanceM >= requiredDistanceM.
//
// Reference is auto-generated SD-YYYY-NNNN (per tenant per year). Locking and
// audit semantics mirror the corrective-actions module.

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
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

export const safeDistanceType = pgEnum('safe_distance_type', [
  'electrical',
  'drone',
  'overhead_crane',
  'vehicle',
  'other',
])

export const safeDistanceRecords = pgTable(
  'safe_distance_records',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // SD-YYYY-NNNN

    type: safeDistanceType('type').notNull(),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),

    // Electrical: kV of the source line. Null for non-electrical types.
    sourceVoltageKv: numeric('source_voltage_kv', { precision: 8, scale: 2 }),
    // Drone: operating height above ground in metres. Optional everywhere else.
    heightM: numeric('height_m', { precision: 8, scale: 2 }),
    // Plain-text description of the hazard ("Energised 13.8kV overhead",
    // "Mavic 3 over forecourt", etc.).
    sourceDescription: text('source_description'),

    // Both distances stored in metres. requiredDistanceM is computed at write
    // time from the type + voltage/height tables; complies is the strict
    // actual >= required check stored for cheap roll-up queries.
    requiredDistanceM: numeric('required_distance_m', { precision: 8, scale: 2 }).notNull(),
    actualDistanceM: numeric('actual_distance_m', { precision: 8, scale: 2 }).notNull(),
    complies: boolean('complies').notNull(),

    supervisorTenantUserId: uuid('supervisor_tenant_user_id').references(() => tenantUsers.id),
    operatorPersonId: uuid('operator_person_id').references(() => people.id),

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
    typeIdx: index('safe_distance_records_type_idx').on(t.tenantId, t.type),
    siteIdx: index('safe_distance_records_site_idx').on(t.tenantId, t.siteOrgUnitId),
    occurredIdx: index('safe_distance_records_occurred_idx').on(t.tenantId, t.occurredAt),
    compliesIdx: index('safe_distance_records_complies_idx').on(t.tenantId, t.complies),
  }),
)

export const safeDistanceRecordsRelations = relations(safeDistanceRecords, ({ one }) => ({
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
}))
