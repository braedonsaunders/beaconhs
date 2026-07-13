// Inspection Assignments — recurring schedule for a given inspection_type
// against an audience (roles / persons / sites).
//
// Mirrors the legacy InspectionAssignment + InspectionAssignmentRecord tables:
//   - one inspection_assignments row per (type × audience cohort × cadence)
//   - audience can be expressed via role keys, person ids, or org-unit ids
//   - cron expression drives the dispatch scanner
//   - dueOffsetMinutes lets us set a soft due relative to fire
//
// Compliance is computed by counting inspection_records per assignee per
// period and comparing against `quantityPerPeriod` × the `compliantPercentage`
// threshold. We denormalise the latest compliance snapshot to
// inspection_assignment_compliance for the list view (so the page renders
// without scanning every assignee on every render).

import { relations } from 'drizzle-orm'
import {
  boolean,
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
import { id, softDelete, timestamps } from './_helpers'
import { tenants, users } from './core'
import { people } from './org'
import { inspectionTypes } from './inspection-types'

export const inspectionAssignmentFrequency = pgEnum('inspection_assignment_frequency', [
  'day',
  'week',
  'month',
  'quarter',
  'year',
])

export const inspectionAssignments = pgTable(
  'inspection_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => inspectionTypes.id, { onDelete: 'cascade' }),

    // Cadence — both a freeform cron (for the scanner) and a human-readable
    // frequency bucket (for the compliance computation, which counts records
    // per natural period).
    frequency: inspectionAssignmentFrequency('frequency').default('week').notNull(),
    cron: text('cron'), // optional cron override; falls back to frequency-default
    dueOffsetMinutes: integer('due_offset_minutes'),

    // How many inspections each assignee is expected to complete per period
    quantityPerPeriod: integer('quantity_per_period').default(1).notNull(),

    // What % of expected counts as "compliant" (default 100 = strict)
    compliantPercentage: integer('compliant_percentage').default(100).notNull(),

    // Audience targeting — any subset can apply, OR-d together.
    targetRoleKeys: jsonb('target_role_keys').$type<string[]>().default([]).notNull(),
    targetPersonIds: jsonb('target_person_ids').$type<string[]>().default([]).notNull(),
    targetOrgUnitIds: jsonb('target_org_unit_ids').$type<string[]>().default([]).notNull(),
    targetEverybody: boolean('target_everybody').default(false).notNull(),

    notes: text('notes'),
    enabled: boolean('enabled').default(true).notNull(),

    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),

    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('inspection_assignments_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('inspection_assignments_tenant_id_id_ux').on(t.tenantId, t.id),
    typeIdx: index('inspection_assignments_type_idx').on(t.tenantId, t.typeId),
    nextDueIdx: index('inspection_assignments_next_due_idx').on(t.tenantId, t.nextDueAt),
  }),
)

// Denormalised per-assignee compliance snapshot. Rebuilt by the compliance
// computation job or on-demand by `recomputeAssignmentCompliance`. Kept as a
// regular table (not a view) so we can RLS-scope it cleanly without needing
// security barrier views.
export const inspectionAssignmentCompliance = pgTable(
  'inspection_assignment_compliance',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id').notNull(),
    // Assignee is always a person; the role/site audience expands into N
    // person rows when compliance is recomputed.
    personId: uuid('person_id').notNull(),

    // Snapshot of the most recent 4 periods (P1 = most recent)
    p1Start: date('p1_start'),
    p1End: date('p1_end'),
    p1Count: integer('p1_count').default(0).notNull(),
    p1Expected: integer('p1_expected').default(0).notNull(),
    p1Percent: integer('p1_percent').default(0).notNull(),
    p1Compliant: boolean('p1_compliant').default(false).notNull(),

    p2Count: integer('p2_count').default(0).notNull(),
    p2Expected: integer('p2_expected').default(0).notNull(),
    p2Percent: integer('p2_percent').default(0).notNull(),
    p2Compliant: boolean('p2_compliant').default(false).notNull(),

    p3Count: integer('p3_count').default(0).notNull(),
    p3Expected: integer('p3_expected').default(0).notNull(),
    p3Percent: integer('p3_percent').default(0).notNull(),
    p3Compliant: boolean('p3_compliant').default(false).notNull(),

    p4Count: integer('p4_count').default(0).notNull(),
    p4Expected: integer('p4_expected').default(0).notNull(),
    p4Percent: integer('p4_percent').default(0).notNull(),
    p4Compliant: boolean('p4_compliant').default(false).notNull(),

    // Rolling average across the last 3 completed periods
    overallPercent: integer('overall_percent').default(0).notNull(),

    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('inspection_assignment_compliance_tenant_idx').on(t.tenantId),
    assignmentIdx: index('inspection_assignment_compliance_assignment_idx').on(
      t.tenantId,
      t.assignmentId,
    ),
    personIdx: index('inspection_assignment_compliance_person_idx').on(t.tenantId, t.personId),
    assignmentPersonUx: uniqueIndex('inspection_assignment_compliance_assignment_person_ux').on(
      t.tenantId,
      t.assignmentId,
      t.personId,
    ),
    assignmentFk: foreignKey({
      name: 'inspection_assignment_compliance_tenant_assignment_fk',
      columns: [t.tenantId, t.assignmentId],
      foreignColumns: [inspectionAssignments.tenantId, inspectionAssignments.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'inspection_assignment_compliance_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
  }),
)

// Dispatch ledger — one row per scheduled fire so the scanner stays idempotent.
export const inspectionAssignmentDispatches = pgTable(
  'inspection_assignment_dispatches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    status: text('status').notNull().default('scheduled'),
    audiencePersonIds: jsonb('audience_person_ids').$type<string[]>().default([]).notNull(),
    error: text('error'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('inspection_assignment_dispatches_tenant_idx').on(t.tenantId),
    assignmentIdx: index('inspection_assignment_dispatches_assignment_idx').on(
      t.tenantId,
      t.assignmentId,
      t.occurredAt,
    ),
    assignmentFk: foreignKey({
      name: 'inspection_assignment_dispatches_tenant_assignment_fk',
      columns: [t.tenantId, t.assignmentId],
      foreignColumns: [inspectionAssignments.tenantId, inspectionAssignments.id],
    }).onDelete('cascade'),
  }),
)

export const inspectionAssignmentsRelations = relations(inspectionAssignments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [inspectionAssignments.tenantId], references: [tenants.id] }),
  type: one(inspectionTypes, {
    fields: [inspectionAssignments.typeId],
    references: [inspectionTypes.id],
  }),
  creator: one(users, {
    fields: [inspectionAssignments.createdBy],
    references: [users.id],
  }),
  compliance: many(inspectionAssignmentCompliance),
  dispatches: many(inspectionAssignmentDispatches),
}))

export const inspectionAssignmentComplianceRelations = relations(
  inspectionAssignmentCompliance,
  ({ one }) => ({
    assignment: one(inspectionAssignments, {
      fields: [
        inspectionAssignmentCompliance.tenantId,
        inspectionAssignmentCompliance.assignmentId,
      ],
      references: [inspectionAssignments.tenantId, inspectionAssignments.id],
    }),
    person: one(people, {
      fields: [inspectionAssignmentCompliance.tenantId, inspectionAssignmentCompliance.personId],
      references: [people.tenantId, people.id],
    }),
  }),
)

export const inspectionAssignmentDispatchesRelations = relations(
  inspectionAssignmentDispatches,
  ({ one }) => ({
    assignment: one(inspectionAssignments, {
      fields: [
        inspectionAssignmentDispatches.tenantId,
        inspectionAssignmentDispatches.assignmentId,
      ],
      references: [inspectionAssignments.tenantId, inspectionAssignments.id],
    }),
  }),
)
