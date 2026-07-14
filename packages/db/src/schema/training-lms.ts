// Native LMS — course curriculum, lessons, enrollments, and per-lesson progress.
//
// This is the world-class course-authoring + learner-runtime layer that sits ON
// TOP of the existing native training spine (training_courses / training_classes
// / training_assessment_types / training_records / training_certificates). It is
// DELIBERATELY native: no Forms/Builder or Documents-editor coupling. Rich lesson
// content uses sanitized HTML; quizzes reuse the existing training assessment
// engine; in-person lessons point at a class.
//
//   training_courses (existing spine)
//     └─ training_course_modules (ordered sections)            ← new
//          └─ training_lessons (ordered content items)         ← new
//   training_enrollments (person × course runtime state)       ← new
//     └─ training_lesson_progress (person × lesson)            ← new
//
// On completion an enrollment writes a training_records row (and issues a
// certificate), so the matrix / transcripts / compliance engine light up with
// zero extra wiring.

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
import { tenants, tenantUsers } from './core'
import { people } from './org'
import { trainingClasses, trainingCourses, trainingRecords } from './training'
import { trainingAssessmentTypes, trainingAssessments } from './training-assessments'

// Content blocks used by the native video/file/embed lesson renderer.
export type LessonBlock =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'text'; md: string } // bespoke markdown-lite (escaped-first on render)
  | { id: string; type: 'image'; attachmentId: string; alt?: string; caption?: string }
  | { id: string; type: 'video'; attachmentId?: string; url?: string; caption?: string }
  | { id: string; type: 'file'; attachmentId: string; label?: string }
  | { id: string; type: 'embed'; url: string; caption?: string }
  | { id: string; type: 'callout'; tone: 'info' | 'warning' | 'success' | 'danger'; md: string }
  | { id: string; type: 'divider' }

// Per-criteria checklist on a practical (hands-on) lesson, signed off by an
// evaluator with training manage permission.
export type PracticalCriterion = { id: string; text: string }

// Ordered sections within a course.
export const trainingCourseModules = pgTable(
  'training_course_modules',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_course_modules_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_course_modules_tenant_id_id_ux').on(t.tenantId, t.id),
    courseIdx: index('training_course_modules_course_idx').on(t.tenantId, t.courseId, t.sortOrder),
    courseFk: foreignKey({
      name: 'training_course_modules_tenant_course_fk',
      columns: [t.tenantId, t.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
    }).onDelete('cascade'),
  }),
)

export const trainingLessonKind = pgEnum('training_lesson_kind', [
  'rich', // sanitized rich HTML
  'video', // attachment or external url
  'file', // downloadable attachment
  'embed', // iframe url
  'quiz', // → training_assessment_types (existing engine)
  'session', // → training_classes (in-person / blended)
  'slides', // PPTX master edited and played by Collabora Impress
  'practical', // hands-on/physical test signed off by an evaluator
])

export const trainingLessonCompletionRule = pgEnum('training_lesson_completion_rule', [
  'view', // complete on view / next
  'pass', // must pass the linked assessment
  'acknowledge', // explicit "I have read & understood"
  'min_time', // must spend minTimeSeconds on the lesson
  'evaluator', // an evaluator must sign the learner off (practical lessons)
])

// Ordered content items within a module.
export const trainingLessons = pgTable(
  'training_lessons',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    moduleId: uuid('module_id').notNull(),
    title: text('title').notNull(),
    kind: trainingLessonKind('kind').default('rich').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    // kind = 'rich' (content) | 'practical' (instructions). Sanitized HTML is
    // the single editing/rendering source of truth.
    contentHtml: text('content_html'),
    // kind = 'practical'
    practicalCriteria: jsonb('practical_criteria')
      .$type<PracticalCriterion[]>()
      .default([])
      .notNull(),
    // PPTX master copy. Collabora Impress edits and plays this same file; no
    // PDF or image derivative is created.
    sourceAttachmentId: uuid('source_attachment_id'),
    // kind = 'quiz' → existing native assessment engine
    assessmentTypeId: uuid('assessment_type_id'),
    // kind = 'session' → in-person class
    classId: uuid('class_id'),
    // kind = 'video' | 'file'
    attachmentId: uuid('attachment_id'),
    // kind = 'embed' | external 'video'
    embedUrl: text('embed_url'),
    // Reuse a library content item instead of inline content (rich/video/file/embed).
    contentItemId: uuid('content_item_id'),
    durationMinutes: integer('duration_minutes'),
    isRequired: boolean('is_required').default(true).notNull(),
    completionRule: trainingLessonCompletionRule('completion_rule').default('view').notNull(),
    minTimeSeconds: integer('min_time_seconds'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_lessons_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_lessons_tenant_id_id_ux').on(t.tenantId, t.id),
    courseIdx: index('training_lessons_course_idx').on(t.tenantId, t.courseId),
    moduleIdx: index('training_lessons_module_idx').on(t.tenantId, t.moduleId, t.sortOrder),
    assessmentTypeIdx: index('training_lessons_assessment_type_idx').on(
      t.tenantId,
      t.assessmentTypeId,
    ),
    classIdx: index('training_lessons_class_idx').on(t.tenantId, t.classId),
    courseFk: foreignKey({
      name: 'training_lessons_tenant_course_fk',
      columns: [t.tenantId, t.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
    }).onDelete('cascade'),
    moduleFk: foreignKey({
      name: 'training_lessons_tenant_module_fk',
      columns: [t.tenantId, t.moduleId],
      foreignColumns: [trainingCourseModules.tenantId, trainingCourseModules.id],
    }).onDelete('cascade'),
    assessmentTypeFk: foreignKey({
      name: 'training_lessons_tenant_assessment_type_fk',
      columns: [t.tenantId, t.assessmentTypeId],
      foreignColumns: [trainingAssessmentTypes.tenantId, trainingAssessmentTypes.id],
    }),
    classFk: foreignKey({
      name: 'training_lessons_tenant_class_fk',
      columns: [t.tenantId, t.classId],
      foreignColumns: [trainingClasses.tenantId, trainingClasses.id],
    }),
  }),
)

export const trainingEnrollmentStatus = pgEnum('training_enrollment_status', [
  'not_started',
  'in_progress',
  'completed',
  'expired',
  'withdrawn',
])

export const trainingEnrollmentSource = pgEnum('training_enrollment_source', [
  'self',
  'assigned',
  'compliance',
])

// One row per (person × course): the in-progress runtime state. Immutable
// completion facts live in training_records; this row resets on renewal.
export const trainingEnrollments = pgTable(
  'training_enrollments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    personId: uuid('person_id').notNull(),
    status: trainingEnrollmentStatus('status').default('not_started').notNull(),
    source: trainingEnrollmentSource('source').default('self').notNull(),
    assignedByTenantUserId: uuid('assigned_by_tenant_user_id'),
    progressPercent: integer('progress_percent').default(0).notNull(),
    currentLessonId: uuid('current_lesson_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    dueOn: date('due_on'),
    expiresOn: date('expires_on'),
    // The training_record written when this enrollment completed (provenance).
    recordId: uuid('record_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_enrollments_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_enrollments_tenant_id_id_ux').on(t.tenantId, t.id),
    personIdx: index('training_enrollments_person_idx').on(t.tenantId, t.personId),
    courseIdx: index('training_enrollments_course_idx').on(t.tenantId, t.courseId),
    assignedByIdx: index('training_enrollments_assigned_by_idx').on(
      t.tenantId,
      t.assignedByTenantUserId,
    ),
    recordIdx: index('training_enrollments_record_idx').on(t.tenantId, t.recordId),
    personCourseUx: uniqueIndex('training_enrollments_person_course_ux').on(
      t.tenantId,
      t.courseId,
      t.personId,
    ),
    courseFk: foreignKey({
      name: 'training_enrollments_tenant_course_fk',
      columns: [t.tenantId, t.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'training_enrollments_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    assignedByFk: foreignKey({
      name: 'training_enrollments_tenant_assigned_by_fk',
      columns: [t.tenantId, t.assignedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    recordFk: foreignKey({
      name: 'training_enrollments_tenant_record_fk',
      columns: [t.tenantId, t.recordId],
      foreignColumns: [trainingRecords.tenantId, trainingRecords.id],
    }),
  }),
)

export const trainingProgressStatus = pgEnum('training_progress_status', [
  'not_started',
  'in_progress',
  'completed',
])

// One row per (enrollment × lesson). This is the xAPI-shaped event log the
// deferred SCORM/xAPI wave will read from.
export const trainingLessonProgress = pgTable(
  'training_lesson_progress',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
    personId: uuid('person_id').notNull(),
    status: trainingProgressStatus('status').default('not_started').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    timeSpentSeconds: integer('time_spent_seconds').default(0).notNull(),
    score: integer('score'), // quiz lessons: 0..100
    attempts: integer('attempts').default(0).notNull(),
    // Resume payload: video seconds / scroll offset / (future) SCORM suspend_data.
    lastPosition: jsonb('last_position').$type<Record<string, unknown> | null>(),
    // quiz lessons: link to the concrete attempt in the existing engine.
    assessmentId: uuid('assessment_id'),
    // practical lessons: evaluator sign-off
    evaluatedByTenantUserId: uuid('evaluated_by_tenant_user_id'),
    evaluationNotes: text('evaluation_notes'),
    evaluationSignatureAttachmentId: uuid('evaluation_signature_attachment_id'),
    criteriaResults: jsonb('criteria_results').$type<Record<string, boolean> | null>(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_lesson_progress_tenant_idx').on(t.tenantId),
    enrollmentIdx: index('training_lesson_progress_enrollment_idx').on(t.tenantId, t.enrollmentId),
    lessonIdx: index('training_lesson_progress_lesson_idx').on(t.tenantId, t.lessonId),
    personIdx: index('training_lesson_progress_person_idx').on(t.tenantId, t.personId),
    assessmentIdx: index('training_lesson_progress_assessment_idx').on(t.tenantId, t.assessmentId),
    evaluatedByIdx: index('training_lesson_progress_evaluated_by_idx').on(
      t.tenantId,
      t.evaluatedByTenantUserId,
    ),
    lessonUx: uniqueIndex('training_lesson_progress_lesson_ux').on(
      t.tenantId,
      t.enrollmentId,
      t.lessonId,
    ),
    enrollmentFk: foreignKey({
      name: 'training_lesson_progress_tenant_enrollment_fk',
      columns: [t.tenantId, t.enrollmentId],
      foreignColumns: [trainingEnrollments.tenantId, trainingEnrollments.id],
    }).onDelete('cascade'),
    lessonFk: foreignKey({
      name: 'training_lesson_progress_tenant_lesson_fk',
      columns: [t.tenantId, t.lessonId],
      foreignColumns: [trainingLessons.tenantId, trainingLessons.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'training_lesson_progress_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    assessmentFk: foreignKey({
      name: 'training_lesson_progress_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [trainingAssessments.tenantId, trainingAssessments.id],
    }),
    evaluatedByFk: foreignKey({
      name: 'training_lesson_progress_tenant_evaluated_by_fk',
      columns: [t.tenantId, t.evaluatedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

// --- Relations -------------------------------------------------------------

export const trainingCourseModulesRelations = relations(trainingCourseModules, ({ one, many }) => ({
  course: one(trainingCourses, {
    fields: [trainingCourseModules.courseId],
    references: [trainingCourses.id],
  }),
  lessons: many(trainingLessons),
}))

export const trainingLessonsRelations = relations(trainingLessons, ({ one }) => ({
  module: one(trainingCourseModules, {
    fields: [trainingLessons.moduleId],
    references: [trainingCourseModules.id],
  }),
  course: one(trainingCourses, {
    fields: [trainingLessons.courseId],
    references: [trainingCourses.id],
  }),
  assessmentType: one(trainingAssessmentTypes, {
    fields: [trainingLessons.assessmentTypeId],
    references: [trainingAssessmentTypes.id],
  }),
}))

export const trainingEnrollmentsRelations = relations(trainingEnrollments, ({ one, many }) => ({
  course: one(trainingCourses, {
    fields: [trainingEnrollments.courseId],
    references: [trainingCourses.id],
  }),
  person: one(people, { fields: [trainingEnrollments.personId], references: [people.id] }),
  progress: many(trainingLessonProgress),
}))

export const trainingLessonProgressRelations = relations(trainingLessonProgress, ({ one }) => ({
  enrollment: one(trainingEnrollments, {
    fields: [trainingLessonProgress.enrollmentId],
    references: [trainingEnrollments.id],
  }),
  lesson: one(trainingLessons, {
    fields: [trainingLessonProgress.lessonId],
    references: [trainingLessons.id],
  }),
}))

// --- Reusable content library ----------------------------------------------
//
// "Material outside the course" — reusable content items referenced by lessons
// via training_lessons.content_item_id. Quizzes (assessment types) and sessions
// (classes) are already their own reusable entities, so they're not duplicated
// here — the library covers rich / video / file / embed material.
export const trainingContentItemKind = pgEnum('training_content_item_kind', [
  'rich',
  'video',
  'file',
  'embed',
  'slides',
])

export const trainingContentItems = pgTable(
  'training_content_items',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    kind: trainingContentItemKind('kind').default('rich').notNull(),
    contentHtml: text('content_html'),
    // PPTX master copy (see trainingLessons.sourceAttachmentId).
    sourceAttachmentId: uuid('source_attachment_id'),
    attachmentId: uuid('attachment_id'),
    embedUrl: text('embed_url'),
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    durationMinutes: integer('duration_minutes'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_content_items_tenant_idx').on(t.tenantId),
    kindIdx: index('training_content_items_kind_idx').on(t.tenantId, t.kind),
  }),
)
