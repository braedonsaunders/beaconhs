// Training & certifications.
// Course catalogue, scheduled classes, attendance, individual records, certificates,
// skills (evaluator sign-off), and the per-role/per-site training matrix.

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers, users } from './core'
import { orgUnits, people } from './org'

export const trainingDeliveryType = pgEnum('training_delivery_type', [
  'classroom',
  'self_paced',
  'on_the_job',
  'external_certificate',
])

export const trainingCourses = pgTable(
  'training_courses',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    deliveryType: trainingDeliveryType('delivery_type').notNull(),
    durationMinutes: integer('duration_minutes'),
    validForMonths: integer('valid_for_months'), // null = doesn't expire
    requiresEvaluator: boolean('requires_evaluator').default(false).notNull(),
    // Course assets (slides, video, doc references)
    materialAttachmentIds: jsonb('material_attachment_ids').$type<string[]>().default([]).notNull(),
    // For self_paced: embedded assessment definition
    assessment: jsonb('assessment').$type<TrainingAssessmentSchema | null>(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_courses_tenant_idx').on(t.tenantId),
    tenantCodeIdx: index('training_courses_tenant_code_idx').on(t.tenantId, t.code),
  }),
)

export type TrainingAssessmentSchema = {
  passingScore: number
  shuffleQuestions?: boolean
  attemptsAllowed?: number
  questions: {
    id: string
    prompt: string
    type: 'single' | 'multiple' | 'short'
    options?: { value: string; label: string; correct?: boolean }[]
    correctAnswer?: string
    weight?: number
  }[]
}

// Scheduled instructor-led class.
export const trainingClasses = pgTable(
  'training_classes',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    instructorTenantUserId: uuid('instructor_tenant_user_id').references(() => tenantUsers.id),
    capacity: integer('capacity'),
    // Hours credited per attendee per day, and how many days the class spans.
    // Both optional: when null, outbound time integrations derive hours from
    // starts_at/ends_at (single-day) and fall back to a sensible default for
    // multi-day classes. Set them to override the derivation.
    hoursPerDay: numeric('hours_per_day', { precision: 5, scale: 2 }),
    lengthDays: integer('length_days'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_classes_tenant_idx').on(t.tenantId),
    courseIdx: index('training_classes_course_idx').on(t.courseId),
    startsIdx: index('training_classes_starts_idx').on(t.tenantId, t.startsAt),
  }),
)

export const trainingClassAttendance = pgEnum('training_class_attendance', [
  'registered',
  'attended',
  'no_show',
  'cancelled',
])

export const trainingClassAttendees = pgTable(
  'training_class_attendees',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => trainingClasses.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    status: trainingClassAttendance('status').default('registered').notNull(),
    signInAt: timestamp('sign_in_at', { withTimezone: true }),
    signatureAttachmentId: uuid('signature_attachment_id'),
    ...timestamps,
  },
  (t) => ({
    classIdx: index('training_class_attendees_class_idx').on(t.classId),
    personIdx: index('training_class_attendees_person_idx').on(t.tenantId, t.personId),
  }),
)

// A person earned a course. Source can be a class, a self-paced completion, an evaluator, or an external upload.
export const trainingRecordSource = pgEnum('training_record_source', [
  'class',
  'self_paced',
  'evaluator',
  'external_upload',
  'migrated',
])

export const trainingRecords = pgTable(
  'training_records',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id),
    source: trainingRecordSource('source').notNull(),
    classId: uuid('class_id').references(() => trainingClasses.id),
    score: integer('score'),
    grade: integer('grade'), // percentage 0..100
    completedOn: date('completed_on').notNull(),
    expiresOn: date('expires_on'),
    instructor: text('instructor'),
    evaluatorPersonId: uuid('evaluator_person_id').references(() => people.id),
    certificateType: text('certificate_type'), // 'auto' | 'photo' | null
    certificateAttachmentId: uuid('certificate_attachment_id'),
    issuedByTenantUserId: uuid('issued_by_tenant_user_id').references(() => tenantUsers.id),
    details: text('details'),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_records_tenant_idx').on(t.tenantId),
    personCourseIdx: index('training_records_person_course_idx').on(
      t.tenantId,
      t.personId,
      t.courseId,
    ),
    expiresIdx: index('training_records_expires_idx').on(t.tenantId, t.expiresOn),
  }),
)

// Issued certificate (PDF + QR-verifiable token).
export const trainingCertificates = pgTable(
  'training_certificates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id')
      .notNull()
      .references(() => trainingRecords.id, { onDelete: 'cascade' }),
    pdfAttachmentId: uuid('pdf_attachment_id'),
    verifyToken: text('verify_token').notNull(), // public, opaque; resolves to record
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    ...timestamps,
  },
  (t) => ({
    recordIdx: index('training_certificates_record_idx').on(t.recordId),
    tokenIdx: index('training_certificates_token_idx').on(t.verifyToken),
  }),
)

export const trainingCoursesRelations = relations(trainingCourses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [trainingCourses.tenantId], references: [tenants.id] }),
  classes: many(trainingClasses),
  records: many(trainingRecords),
}))

export const trainingRecordsRelations = relations(trainingRecords, ({ one, many }) => ({
  tenant: one(tenants, { fields: [trainingRecords.tenantId], references: [tenants.id] }),
  person: one(people, { fields: [trainingRecords.personId], references: [people.id] }),
  course: one(trainingCourses, {
    fields: [trainingRecords.courseId],
    references: [trainingCourses.id],
  }),
  certificates: many(trainingCertificates),
}))
