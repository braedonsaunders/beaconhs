// Incident taxonomy + hours-worked tracker — tenant-defined reference data
// that supports the OSHA / TRIR / DART-style reporting required by the legacy
// BeaconHS incident workflow.
//
// Three siblings here:
//   - incident_classifications  hierarchical category (parentId).  Legacy
//                                parity: INCIDENTCLASSIFICATIONS table.
//                                The `classification` JSON column on
//                                `incidents` references these by id.
//   - incident_injury_types     flat list of injury labels (laceration,
//                                strain, fracture …) — referenced from the
//                                `injuryTypes` JSON array on
//                                `incident_injuries`.  Legacy parity:
//                                INCIDENTINJURIES table.
//   - incident_hours_periods    per-period hours-worked + employee-count
//                                rollup.  Drives every frequency-rate
//                                calculation (TRIR / DART / LTIR).  Legacy
//                                parity: INCIDENTHOURSWORKED, except the
//                                legacy schema was "year + quarter +
//                                division" — we model it as an arbitrary
//                                date range with an optional label so a
//                                tenant can record monthly, quarterly or
//                                project-based windows side-by-side.

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
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { orgUnits } from './org'

// --- Classifications --------------------------------------------------------
//
// Hierarchical.  A typical tenant tree:
//   Health & Safety
//     ├─ Injury
//     │   ├─ Slip / trip / fall
//     │   └─ Caught in / between
//     └─ Illness
//   Environmental
//     └─ Spill
//   Security
//     └─ Theft
//
// Stored as adjacency list (parentId). 64 rows max in practice — depth-2
// recursive query is fine without a CTE.

export const incidentClassifications = pgTable(
  'incident_classifications',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    description: text('description'),
    // Optional 3-char code for OSHA-log column ("INJ", "ILL", "PD", …).
    code: text('code'),
    // Used to order siblings in admin UI; nulls sort last.
    sortOrder: integer('sort_order'),
    // Flag distinguishes "OSHA-recordable" classifications from purely
    // internal categories.  Drives the TRIR + DART rollups.
    isRecordable: integer('is_recordable').default(0).notNull(),
    // Soft archive — keep historic incidents linked but hide from new-record
    // pickers.
    isActive: integer('is_active').default(1).notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(
      () => tenantUsers.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('incident_classifications_tenant_idx').on(t.tenantId),
    parentIdx: index('incident_classifications_parent_idx').on(t.parentId),
    tenantNameUx: uniqueIndex('incident_classifications_tenant_parent_name_ux').on(
      t.tenantId,
      t.parentId,
      t.name,
    ),
  }),
)

export const incidentClassificationsRelations = relations(
  incidentClassifications,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [incidentClassifications.tenantId],
      references: [tenants.id],
    }),
    parent: one(incidentClassifications, {
      fields: [incidentClassifications.parentId],
      references: [incidentClassifications.id],
      relationName: 'incident_classification_parent',
    }),
    children: many(incidentClassifications, {
      relationName: 'incident_classification_parent',
    }),
  }),
)

// --- Injury types -----------------------------------------------------------
//
// Flat reference list.  Tenant admins add what they want — typical seed is
// laceration / contusion / strain / fracture / burn / chemical-exposure.

export const incidentInjuryTypes = pgTable(
  'incident_injury_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    // OSHA body-part / nature-of-injury code — optional convenience field
    // used by the OSHA-300 PDF exporter.
    oshaCode: text('osha_code'),
    sortOrder: integer('sort_order'),
    isActive: integer('is_active').default(1).notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(
      () => tenantUsers.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('incident_injury_types_tenant_idx').on(t.tenantId),
    tenantNameUx: uniqueIndex('incident_injury_types_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

export const incidentInjuryTypesRelations = relations(incidentInjuryTypes, ({ one }) => ({
  tenant: one(tenants, {
    fields: [incidentInjuryTypes.tenantId],
    references: [tenants.id],
  }),
}))

// --- Hours-worked periods ---------------------------------------------------
//
// Each row records the total hours worked + employee count for a
// (tenant, optional site, optional label) window.  Many windows per tenant
// — typically one per month per site, but legacy tenants will have one per
// quarter per "division".
//
// Frequency rate (OSHA): (recordable_count * 200000) / sum(totalHours)
// where the sum's window matches the report's window.

export const incidentHoursPeriods = pgTable(
  'incident_hours_periods',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Optional scope.  Null orgUnitId = tenant-wide window (most common).
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id, {
      onDelete: 'set null',
    }),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    // Human-readable label: "2026 Q1", "March 2026", "Turnaround 2026", …
    periodLabel: text('period_label'),
    // numeric so partial-hour totals (subcontractor records, salaried-staff
    // pro-rate) round-trip without floating-point drift.
    totalHours: numeric('total_hours', { precision: 14, scale: 2 }).notNull(),
    employeeCount: integer('employee_count').notNull(),
    notes: text('notes'),
    enteredByTenantUserId: uuid('entered_by_tenant_user_id').references(
      () => tenantUsers.id,
      { onDelete: 'set null' },
    ),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('incident_hours_periods_tenant_idx').on(t.tenantId),
    rangeIdx: index('incident_hours_periods_range_idx').on(
      t.tenantId,
      t.periodStart,
      t.periodEnd,
    ),
    siteIdx: index('incident_hours_periods_site_idx').on(t.tenantId, t.siteOrgUnitId),
  }),
)

export const incidentHoursPeriodsRelations = relations(incidentHoursPeriods, ({ one }) => ({
  tenant: one(tenants, {
    fields: [incidentHoursPeriods.tenantId],
    references: [tenants.id],
  }),
  site: one(orgUnits, {
    fields: [incidentHoursPeriods.siteOrgUnitId],
    references: [orgUnits.id],
  }),
}))
