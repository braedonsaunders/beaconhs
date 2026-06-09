// Native LMS — course curriculum, lessons, enrollments, and per-lesson progress.
//
// This is the world-class course-authoring + learner-runtime layer that sits ON
// TOP of the existing native training spine (training_courses / training_classes
// / training_assessment_types / training_records / training_certificates). It is
// DELIBERATELY native: no Forms/Builder, no Documents-editor coupling. Rich lesson
// content is stored as a bespoke block array (LessonBlock[]); quizzes reuse the
// existing native training assessment engine; in-person lessons point at a class.
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

// --- Bespoke lesson content model -----------------------------------------
//
// A rich lesson is a vertical stack of blocks authored in the native training
// studio. Intentionally our OWN shape (NOT ProseMirror / the Documents editor).
export type LessonBlock =
  | { id: string; type: 'heading'; level: 1 | 2 | 3; text: string }
  | { id: string; type: 'text'; md: string } // bespoke markdown-lite (escaped-first on render)
  | { id: string; type: 'image'; attachmentId: string; alt?: string; caption?: string }
  | { id: string; type: 'video'; attachmentId?: string; url?: string; caption?: string }
  | { id: string; type: 'file'; attachmentId: string; label?: string }
  | { id: string; type: 'embed'; url: string; caption?: string }
  | { id: string; type: 'callout'; tone: 'info' | 'warning' | 'success' | 'danger'; md: string }
  | { id: string; type: 'divider' }

// Ordered sections within a course.
export const trainingCourseModules = pgTable(
  'training_course_modules',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_course_modules_tenant_idx').on(t.tenantId),
    courseIdx: index('training_course_modules_course_idx').on(t.courseId, t.sortOrder),
  }),
)

export const trainingLessonKind = pgEnum('training_lesson_kind', [
  'rich', // bespoke content blocks
  'video', // attachment or external url
  'file', // downloadable attachment
  'embed', // iframe url
  'quiz', // → training_assessment_types (existing engine)
  'session', // → training_classes (in-person / blended)
])

export const trainingLessonCompletionRule = pgEnum('training_lesson_completion_rule', [
  'view', // complete on view / next
  'pass', // must pass the linked assessment
  'acknowledge', // explicit "I have read & understood"
  'min_time', // must spend minTimeSeconds on the lesson
])

// Ordered content items within a module.
export const trainingLessons = pgTable(
  'training_lessons',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => trainingCourseModules.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    kind: trainingLessonKind('kind').default('rich').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    // kind = 'rich'
    contentBlocks: jsonb('content_blocks').$type<LessonBlock[]>().default([]).notNull(),
    // kind = 'quiz' → existing native assessment engine
    assessmentTypeId: uuid('assessment_type_id').references(() => trainingAssessmentTypes.id, {
      onDelete: 'set null',
    }),
    // kind = 'session' → in-person class
    classId: uuid('class_id').references(() => trainingClasses.id, { onDelete: 'set null' }),
    // kind = 'video' | 'file'
    attachmentId: uuid('attachment_id'),
    // kind = 'embed' | external 'video'
    embedUrl: text('embed_url'),
    durationMinutes: integer('duration_minutes'),
    isRequired: boolean('is_required').default(true).notNull(),
    completionRule: trainingLessonCompletionRule('completion_rule').default('view').notNull(),
    minTimeSeconds: integer('min_time_seconds'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_lessons_tenant_idx').on(t.tenantId),
    courseIdx: index('training_lessons_course_idx').on(t.courseId),
    moduleIdx: index('training_lessons_module_idx').on(t.moduleId, t.sortOrder),
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
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    status: trainingEnrollmentStatus('status').default('not_started').notNull(),
    source: trainingEnrollmentSource('source').default('self').notNull(),
    assignedByTenantUserId: uuid('assigned_by_tenant_user_id').references(() => tenantUsers.id),
    progressPercent: integer('progress_percent').default(0).notNull(),
    currentLessonId: uuid('current_lesson_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    dueOn: date('due_on'),
    expiresOn: date('expires_on'),
    // The training_record written when this enrollment completed (provenance).
    recordId: uuid('record_id').references(() => trainingRecords.id, { onDelete: 'set null' }),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_enrollments_tenant_idx').on(t.tenantId),
    personIdx: index('training_enrollments_person_idx').on(t.tenantId, t.personId),
    courseIdx: index('training_enrollments_course_idx').on(t.tenantId, t.courseId),
    personCourseUx: uniqueIndex('training_enrollments_person_course_ux').on(t.courseId, t.personId),
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
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => trainingEnrollments.id, { onDelete: 'cascade' }),
    lessonId: uuid('lesson_id')
      .notNull()
      .references(() => trainingLessons.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    status: trainingProgressStatus('status').default('not_started').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    timeSpentSeconds: integer('time_spent_seconds').default(0).notNull(),
    score: integer('score'), // quiz lessons: 0..100
    attempts: integer('attempts').default(0).notNull(),
    // Resume payload: video seconds / scroll offset / (future) SCORM suspend_data.
    lastPosition: jsonb('last_position').$type<Record<string, unknown> | null>(),
    // quiz lessons: link to the concrete attempt in the existing engine.
    assessmentId: uuid('assessment_id').references(() => trainingAssessments.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_lesson_progress_tenant_idx').on(t.tenantId),
    enrollmentIdx: index('training_lesson_progress_enrollment_idx').on(t.enrollmentId),
    personIdx: index('training_lesson_progress_person_idx').on(t.tenantId, t.personId),
    lessonUx: uniqueIndex('training_lesson_progress_lesson_ux').on(t.enrollmentId, t.lessonId),
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
