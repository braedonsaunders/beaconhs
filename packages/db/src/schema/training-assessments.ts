// Training Assessments — graded quiz/test bank.
//
// Two-layer model:
//   1. `training_assessment_types` is the admin-defined template (the "test bank"):
//      name, description, passing_score, optional link to a course. Has many
//      `training_assessment_type_questions` rows with type/options/correctAnswer/points.
//   2. `training_assessments` is one concrete attempt (a person sat the quiz):
//      personId, typeId, score, passed bool, completedAt, status. Has many
//      `training_assessment_results` rows — one per question — capturing the
//      submitted answer, correct bool, points awarded.
//
// On pass, if the type is linked to a course, the submission action creates a
// `training_records` row so the matrix view picks it up.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
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
import { tenants, tenantUsers } from './core'
import { complianceObligations } from './compliance'
import { people } from './org'
import { trainingCourses } from './training'

// ---------------------------------------------------------------------------
// Assessment Types (admin-defined quiz templates / test banks)
// ---------------------------------------------------------------------------

export const trainingAssessmentTypes = pgTable(
  'training_assessment_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    // 0-100 — minimum percentage required to pass.
    passingScore: integer('passing_score').default(80).notNull(),
    // Optional link to a course. When set, a passing attempt writes a
    // training_records row so it shows up on the matrix.
    courseId: uuid('course_id'),
    // Shown to the candidate before they start.
    preAssessmentMessage: text('pre_assessment_message'),
    // Shown after completion (pass or fail).
    postAssessmentMessage: text('post_assessment_message'),
    // Whether attempts get a numeric grade and pass/fail or are just "completed".
    graded: boolean('graded').default(true).notNull(),
    // Whether the assessment is published and available for assignment.
    active: boolean('active').default(true).notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_assessment_types_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_assessment_types_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantActiveIdx: index('training_assessment_types_tenant_active_idx').on(t.tenantId, t.active),
    courseIdx: index('training_assessment_types_course_idx').on(t.tenantId, t.courseId),
    createdByIdx: index('training_assessment_types_created_by_idx').on(
      t.tenantId,
      t.createdByTenantUserId,
    ),
    courseFk: foreignKey({
      name: 'training_assessment_types_tenant_course_fk',
      columns: [t.tenantId, t.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
    }),
    createdByFk: foreignKey({
      name: 'training_assessment_types_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const trainingAssessmentQuestionKind = pgEnum('training_assessment_question_kind', [
  'text', // free text — never auto-graded
  'single_choice', // exactly one of N options is correct
  'multi_choice', // any subset of N options is correct (jaccard / exact match)
  'numeric', // numeric input, equality check
  'true_false', // dedicated boolean variant
])

export const trainingAssessmentTypeQuestions = pgTable(
  'training_assessment_type_questions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id').notNull(),
    prompt: text('prompt').notNull(),
    kind: trainingAssessmentQuestionKind('kind').notNull(),
    // For single_choice / multi_choice: array of { value, label } options.
    // For true_false: ignored (always [true, false]).
    options: jsonb('options').$type<{ value: string; label: string }[] | null>(),
    // For single_choice / true_false / numeric: scalar value.
    // For multi_choice: comma-separated value list (canonical-sorted on save).
    correctAnswer: text('correct_answer'),
    helpText: text('help_text'),
    // Points awarded for a correct answer. Defaults to 1 for an even-weighted quiz.
    points: integer('points').default(1).notNull(),
    // 1-based display ordering. Reorder action rewrites all positions.
    entityOrder: integer('entity_order').default(0).notNull(),
    mandatory: boolean('mandatory').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_assessment_type_questions_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_assessment_type_questions_tenant_id_id_ux').on(
      t.tenantId,
      t.id,
    ),
    typeIdx: index('training_assessment_type_questions_type_idx').on(
      t.tenantId,
      t.typeId,
      t.entityOrder,
    ),
    typeFk: foreignKey({
      name: 'training_assessment_type_questions_tenant_type_fk',
      columns: [t.tenantId, t.typeId],
      foreignColumns: [trainingAssessmentTypes.tenantId, trainingAssessmentTypes.id],
    }).onDelete('cascade'),
  }),
)

// ---------------------------------------------------------------------------
// Concrete attempts
// ---------------------------------------------------------------------------

export const trainingAssessmentStatus = pgEnum('training_assessment_status', [
  'in_progress',
  'submitted', // graded
  'cancelled',
])

export const trainingAssessments = pgTable(
  'training_assessments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id').notNull(),
    personId: uuid('person_id').notNull(),
    // Snapshot the linked course at attempt time (so renaming/moving the type's
    // course later doesn't retroactively rewrite history).
    courseId: uuid('course_id'),
    // Snapshot the passing score from the type so historical attempts read the
    // same threshold they were graded against.
    passingScore: integer('passing_score').notNull(),
    // 0-100 percentage. Null while in_progress.
    score: integer('score'),
    pointsAwarded: integer('points_awarded'),
    pointsPossible: integer('points_possible'),
    passed: boolean('passed'),
    status: trainingAssessmentStatus('status').default('in_progress').notNull(),
    // Exact canonical requirement that launched this attempt. Standalone and
    // lesson-quiz attempts remain null; assigned assessment evidence is never
    // inferred from another attempt against the same assessment type.
    complianceObligationId: uuid('compliance_obligation_id'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    submittedByTenantUserId: uuid('submitted_by_tenant_user_id'),
    // Triggered training record id (populated when course-linked + passed).
    trainingRecordId: uuid('training_record_id'),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_assessments_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_assessments_tenant_id_id_ux').on(t.tenantId, t.id),
    personIdx: index('training_assessments_person_idx').on(t.tenantId, t.personId),
    typeIdx: index('training_assessments_type_idx').on(t.tenantId, t.typeId),
    courseIdx: index('training_assessments_course_idx').on(t.tenantId, t.courseId),
    complianceObligationIdx: index('training_assessments_compliance_obligation_idx').on(
      t.tenantId,
      t.complianceObligationId,
    ),
    activeComplianceAttemptUx: uniqueIndex('training_assessments_active_compliance_attempt_ux')
      .on(t.tenantId, t.complianceObligationId, t.personId)
      .where(
        sql`${t.complianceObligationId} is not null and ${t.status} = 'in_progress' and ${t.deletedAt} is null`,
      ),
    submittedByIdx: index('training_assessments_submitted_by_idx').on(
      t.tenantId,
      t.submittedByTenantUserId,
    ),
    statusIdx: index('training_assessments_status_idx').on(t.tenantId, t.status),
    completedIdx: index('training_assessments_completed_idx').on(t.tenantId, t.completedAt),
    typeFk: foreignKey({
      name: 'training_assessments_tenant_type_fk',
      columns: [t.tenantId, t.typeId],
      foreignColumns: [trainingAssessmentTypes.tenantId, trainingAssessmentTypes.id],
    }).onDelete('restrict'),
    personFk: foreignKey({
      name: 'training_assessments_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    courseFk: foreignKey({
      name: 'training_assessments_tenant_course_fk',
      columns: [t.tenantId, t.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
    }),
    complianceObligationFk: foreignKey({
      name: 'training_assessments_tenant_compliance_obligation_fk',
      columns: [t.tenantId, t.complianceObligationId],
      foreignColumns: [complianceObligations.tenantId, complianceObligations.id],
    }),
    submittedByFk: foreignKey({
      name: 'training_assessments_tenant_submitted_by_fk',
      columns: [t.tenantId, t.submittedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const trainingAssessmentResults = pgTable(
  'training_assessment_results',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull(),
    questionId: uuid('question_id').notNull(),
    // Snapshot the prompt + correct answer at attempt time. If the admin later
    // edits the question, this attempt still shows what the user actually saw.
    promptSnapshot: text('prompt_snapshot').notNull(),
    correctAnswerSnapshot: text('correct_answer_snapshot'),
    kindSnapshot: trainingAssessmentQuestionKind('kind_snapshot').notNull(),
    answer: text('answer'),
    correct: boolean('correct'),
    pointsAwarded: integer('points_awarded').default(0).notNull(),
    pointsPossible: integer('points_possible').default(1).notNull(),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('training_assessment_results_assessment_idx').on(
      t.tenantId,
      t.assessmentId,
    ),
    questionIdx: index('training_assessment_results_question_idx').on(t.tenantId, t.questionId),
    tenantIdx: index('training_assessment_results_tenant_idx').on(t.tenantId),
    assessmentFk: foreignKey({
      name: 'training_assessment_results_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [trainingAssessments.tenantId, trainingAssessments.id],
    }).onDelete('cascade'),
    questionFk: foreignKey({
      name: 'training_assessment_results_tenant_question_fk',
      columns: [t.tenantId, t.questionId],
      foreignColumns: [
        trainingAssessmentTypeQuestions.tenantId,
        trainingAssessmentTypeQuestions.id,
      ],
    }).onDelete('restrict'),
  }),
)

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const trainingAssessmentTypesRelations = relations(
  trainingAssessmentTypes,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [trainingAssessmentTypes.tenantId],
      references: [tenants.id],
    }),
    course: one(trainingCourses, {
      fields: [trainingAssessmentTypes.courseId],
      references: [trainingCourses.id],
    }),
    questions: many(trainingAssessmentTypeQuestions),
    attempts: many(trainingAssessments),
  }),
)

export const trainingAssessmentTypeQuestionsRelations = relations(
  trainingAssessmentTypeQuestions,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [trainingAssessmentTypeQuestions.tenantId],
      references: [tenants.id],
    }),
    type: one(trainingAssessmentTypes, {
      fields: [trainingAssessmentTypeQuestions.typeId],
      references: [trainingAssessmentTypes.id],
    }),
    results: many(trainingAssessmentResults),
  }),
)

export const trainingAssessmentsRelations = relations(trainingAssessments, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [trainingAssessments.tenantId],
    references: [tenants.id],
  }),
  type: one(trainingAssessmentTypes, {
    fields: [trainingAssessments.typeId],
    references: [trainingAssessmentTypes.id],
  }),
  person: one(people, {
    fields: [trainingAssessments.personId],
    references: [people.id],
  }),
  course: one(trainingCourses, {
    fields: [trainingAssessments.courseId],
    references: [trainingCourses.id],
  }),
  complianceObligation: one(complianceObligations, {
    fields: [trainingAssessments.complianceObligationId],
    references: [complianceObligations.id],
  }),
  results: many(trainingAssessmentResults),
}))

export const trainingAssessmentResultsRelations = relations(
  trainingAssessmentResults,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [trainingAssessmentResults.tenantId],
      references: [tenants.id],
    }),
    assessment: one(trainingAssessments, {
      fields: [trainingAssessmentResults.assessmentId],
      references: [trainingAssessments.id],
    }),
    question: one(trainingAssessmentTypeQuestions, {
      fields: [trainingAssessmentResults.questionId],
      references: [trainingAssessmentTypeQuestions.id],
    }),
  }),
)
