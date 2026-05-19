// Training Assignments (audience-based) — "send this course or assessment to
// these people by this date".
//
// `training_assignments` already exists in `training.ts`, but that table models
// the static "required-by-role" matrix used to compute the matrix view's
// expected coverage. This file adds audience-targeted, dated, optionally
// recurring assignments (e.g. "Marcus + the Welder trade need to complete
// WHMIS by 2026-06-30, then again every 12 months").
//
// Tables:
//   - training_audience_assignments         (one row per assignment)
//   - training_audience_assignment_targets  (audience entries: person/role/trade)
//   - training_audience_assignment_records  (computed per-person status snapshot)
//
// The "compliance %" surfaced on the assignments index/detail is computed live
// from training_records + training_assessments at read time (no materialised
// view), with this `records` table acting as a row-per-person scoreboard that
// the assignment-evaluator action keeps in sync.

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
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
import { tenants, tenantUsers } from './core'
import { people, trades } from './org'
import { trainingCourses } from './training'
import { trainingAssessmentTypes } from './training-assessments'

export const trainingAudienceAssignmentTargetKind = pgEnum(
  'training_audience_assignment_target_kind',
  ['person', 'trade', 'role', 'everyone'],
)

export const trainingAudienceAssignmentItemKind = pgEnum(
  'training_audience_assignment_item_kind',
  ['course', 'assessment_type'],
)

export const trainingAudienceAssignmentStatus = pgEnum(
  'training_audience_assignment_status',
  ['active', 'archived'],
)

export const trainingAudienceAssignments = pgTable(
  'training_audience_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    notes: text('notes'),
    // Exactly one of the two will be populated (validated in the action layer).
    itemKind: trainingAudienceAssignmentItemKind('item_kind').notNull(),
    courseId: uuid('course_id').references(() => trainingCourses.id, { onDelete: 'cascade' }),
    assessmentTypeId: uuid('assessment_type_id').references(() => trainingAssessmentTypes.id, {
      onDelete: 'cascade',
    }),
    dueOn: date('due_on'),
    // Optional cron expression for recurring assignments (e.g. yearly WHMIS).
    // Worker reads this offline; we just store it.
    recurrenceCron: text('recurrence_cron'),
    // How many days before due to start nagging.
    remindBeforeDays: integer('remind_before_days').default(7).notNull(),
    status: trainingAudienceAssignmentStatus('status').default('active').notNull(),
    assignedByTenantUserId: uuid('assigned_by_tenant_user_id').references(() => tenantUsers.id),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_audience_assignments_tenant_idx').on(t.tenantId),
    tenantStatusIdx: index('training_audience_assignments_tenant_status_idx').on(
      t.tenantId,
      t.status,
    ),
    dueIdx: index('training_audience_assignments_due_idx').on(t.tenantId, t.dueOn),
    courseIdx: index('training_audience_assignments_course_idx').on(t.courseId),
    typeIdx: index('training_audience_assignments_type_idx').on(t.assessmentTypeId),
  }),
)

export const trainingAudienceAssignmentTargets = pgTable(
  'training_audience_assignment_targets',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => trainingAudienceAssignments.id, { onDelete: 'cascade' }),
    kind: trainingAudienceAssignmentTargetKind('kind').notNull(),
    // For 'person' → people.id. For 'trade' → trades.id.
    // For 'role'   → roles.key (textual). For 'everyone' → null.
    personId: uuid('person_id').references(() => people.id, { onDelete: 'cascade' }),
    tradeId: uuid('trade_id').references(() => trades.id, { onDelete: 'cascade' }),
    roleKey: text('role_key'),
    ...timestamps,
  },
  (t) => ({
    assignmentIdx: index('training_audience_assignment_targets_assignment_idx').on(
      t.assignmentId,
    ),
    tenantIdx: index('training_audience_assignment_targets_tenant_idx').on(t.tenantId),
  }),
)

// Per-person, per-assignment computed status. We keep one row per (assignment,
// person) once a person has been resolved into the audience; the
// `recomputeAssignmentCompliance` action upserts these rows whenever a
// training_record or assessment lands or when the audience changes.
export const trainingAudienceAssignmentRecordStatus = pgEnum(
  'training_audience_assignment_record_status',
  ['pending', 'in_progress', 'completed', 'overdue'],
)

export const trainingAudienceAssignmentRecords = pgTable(
  'training_audience_assignment_records',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => trainingAudienceAssignments.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    status: trainingAudienceAssignmentRecordStatus('status').default('pending').notNull(),
    completedOn: date('completed_on'),
    // Whichever underlying record satisfied this assignment.
    sourceTrainingRecordId: uuid('source_training_record_id'),
    sourceAssessmentId: uuid('source_assessment_id'),
    lastEvaluatedAt: timestamp('last_evaluated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => ({
    assignmentIdx: index('training_audience_assignment_records_assignment_idx').on(
      t.assignmentId,
    ),
    personIdx: index('training_audience_assignment_records_person_idx').on(
      t.tenantId,
      t.personId,
    ),
    statusIdx: index('training_audience_assignment_records_status_idx').on(
      t.tenantId,
      t.status,
    ),
    uniqAssignmentPerson: uniqueIndex('training_audience_assignment_records_uq').on(
      t.assignmentId,
      t.personId,
    ),
  }),
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const trainingAudienceAssignmentsRelations = relations(
  trainingAudienceAssignments,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [trainingAudienceAssignments.tenantId],
      references: [tenants.id],
    }),
    course: one(trainingCourses, {
      fields: [trainingAudienceAssignments.courseId],
      references: [trainingCourses.id],
    }),
    assessmentType: one(trainingAssessmentTypes, {
      fields: [trainingAudienceAssignments.assessmentTypeId],
      references: [trainingAssessmentTypes.id],
    }),
    targets: many(trainingAudienceAssignmentTargets),
    records: many(trainingAudienceAssignmentRecords),
  }),
)

export const trainingAudienceAssignmentTargetsRelations = relations(
  trainingAudienceAssignmentTargets,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [trainingAudienceAssignmentTargets.tenantId],
      references: [tenants.id],
    }),
    assignment: one(trainingAudienceAssignments, {
      fields: [trainingAudienceAssignmentTargets.assignmentId],
      references: [trainingAudienceAssignments.id],
    }),
    person: one(people, {
      fields: [trainingAudienceAssignmentTargets.personId],
      references: [people.id],
    }),
    trade: one(trades, {
      fields: [trainingAudienceAssignmentTargets.tradeId],
      references: [trades.id],
    }),
  }),
)

export const trainingAudienceAssignmentRecordsRelations = relations(
  trainingAudienceAssignmentRecords,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [trainingAudienceAssignmentRecords.tenantId],
      references: [tenants.id],
    }),
    assignment: one(trainingAudienceAssignments, {
      fields: [trainingAudienceAssignmentRecords.assignmentId],
      references: [trainingAudienceAssignments.id],
    }),
    person: one(people, {
      fields: [trainingAudienceAssignmentRecords.personId],
      references: [people.id],
    }),
  }),
)

// Re-export the boolean used by the compliance helpers. Not a table; just a
// convenient symbolic constant other modules can import for completeness.
export const TRAINING_AUDIENCE_ASSIGNMENT_RECORD_COMPLETED_STATUSES = [
  'completed',
] as const

// Unused helper to silence "TRAINING_AUDIENCE..." linter warning if removed
// elsewhere. Type-only export for boolean.
export type TrainingAudienceAssignmentRecordStatus =
  (typeof trainingAudienceAssignmentRecordStatus.enumValues)[number]
