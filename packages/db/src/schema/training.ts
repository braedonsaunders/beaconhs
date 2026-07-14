// Training & certifications.
// Course catalogue, scheduled classes, attendance, individual records, certificates,
// skills (evaluator sign-off), and the per-role/per-site training matrix.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  foreignKey,
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

export const trainingDeliveryType = pgEnum('training_delivery_type', [
  'classroom',
  'self_paced',
  'on_the_job',
  'external_certificate',
  'online',
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
    // For `online` delivery: the external course URL learners self-launch into,
    // plus rich-text instructions shown alongside it. Learners self-start and
    // self-attest completion, mirroring self_paced.
    onlineUrl: text('online_url'),
    instructions: text('instructions'), // sanitized HTML
    requiresEvaluator: boolean('requires_evaluator').default(false).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_courses_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_courses_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantCodeIdx: index('training_courses_tenant_code_idx').on(t.tenantId, t.code),
  }),
)

// Scheduled instructor-led class.
export const trainingClasses = pgTable(
  'training_classes',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id').notNull(),
    title: text('title').notNull(),
    siteOrgUnitId: uuid('site_org_unit_id'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    instructorTenantUserId: uuid('instructor_tenant_user_id'),
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
    tenantIdIdUx: uniqueIndex('training_classes_tenant_id_id_ux').on(t.tenantId, t.id),
    courseIdx: index('training_classes_course_idx').on(t.tenantId, t.courseId),
    siteIdx: index('training_classes_site_idx').on(t.tenantId, t.siteOrgUnitId),
    instructorIdx: index('training_classes_instructor_idx').on(
      t.tenantId,
      t.instructorTenantUserId,
    ),
    startsIdx: index('training_classes_starts_idx').on(t.tenantId, t.startsAt),
    courseFk: foreignKey({
      name: 'training_classes_tenant_course_fk',
      columns: [t.tenantId, t.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
    }).onDelete('cascade'),
    siteFk: foreignKey({
      name: 'training_classes_tenant_site_fk',
      columns: [t.tenantId, t.siteOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id],
    }),
    instructorFk: foreignKey({
      name: 'training_classes_tenant_instructor_fk',
      columns: [t.tenantId, t.instructorTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
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
    classId: uuid('class_id').notNull(),
    personId: uuid('person_id').notNull(),
    status: trainingClassAttendance('status').default('registered').notNull(),
    signInAt: timestamp('sign_in_at', { withTimezone: true }),
    signatureAttachmentId: uuid('signature_attachment_id'),
    // Completion is reviewed and persisted page-by-page before the class is
    // finalized. Nullable values mean "not reviewed"; finalization refuses to
    // infer a result for any attendee that has not been explicitly reviewed.
    completionAttended: boolean('completion_attended'),
    completionPassed: boolean('completion_passed'),
    completionGrade: integer('completion_grade'),
    completionReviewedAt: timestamp('completion_reviewed_at', { withTimezone: true }),
    completionReviewedByTenantUserId: uuid('completion_reviewed_by_tenant_user_id'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    classIdx: index('training_class_attendees_class_idx').on(t.tenantId, t.classId),
    personIdx: index('training_class_attendees_person_idx').on(t.tenantId, t.personId),
    classPersonUx: uniqueIndex('training_class_attendees_tenant_class_person_ux').on(
      t.tenantId,
      t.classId,
      t.personId,
    ),
    completionReviewerIdx: index('training_class_attendees_completion_reviewer_idx').on(
      t.tenantId,
      t.completionReviewedByTenantUserId,
    ),
    classFk: foreignKey({
      name: 'training_class_attendees_tenant_class_fk',
      columns: [t.tenantId, t.classId],
      foreignColumns: [trainingClasses.tenantId, trainingClasses.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'training_class_attendees_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    completionReviewerFk: foreignKey({
      name: 'training_class_attendees_tenant_completion_reviewer_fk',
      columns: [t.tenantId, t.completionReviewedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    completionGradeCheck: check(
      'training_class_attendees_completion_grade_ck',
      sql`${t.completionGrade} IS NULL OR (${t.completionGrade} >= 0 AND ${t.completionGrade} <= 100)`,
    ),
    completionReviewCheck: check(
      'training_class_attendees_completion_review_ck',
      sql`(
        ${t.completionReviewedAt} IS NULL
        AND ${t.completionReviewedByTenantUserId} IS NULL
        AND ${t.completionAttended} IS NULL
        AND ${t.completionPassed} IS NULL
        AND ${t.completionGrade} IS NULL
      ) OR (
        ${t.completionReviewedAt} IS NOT NULL
        AND ${t.completionAttended} IS NOT NULL
        AND ${t.completionPassed} IS NOT NULL
        AND (${t.completionAttended} OR NOT ${t.completionPassed})
      )`,
    ),
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
    // Nullable so "New certificate" can land on a genuinely blank draft record
    // (no defaulted person/course that looks pre-existing). Lists/reports filter
    // out drafts where either is still null. Mirrors the hazid draft model.
    personId: uuid('person_id'),
    courseId: uuid('course_id'),
    source: trainingRecordSource('source').notNull(),
    classId: uuid('class_id'),
    score: integer('score'),
    grade: integer('grade'), // percentage 0..100
    completedOn: date('completed_on').notNull(),
    expiresOn: date('expires_on'),
    instructor: text('instructor'),
    evaluatorPersonId: uuid('evaluator_person_id'),
    certificateType: text('certificate_type'), // 'auto' | 'photo' | null
    certificateAttachmentId: uuid('certificate_attachment_id'),
    issuedByTenantUserId: uuid('issued_by_tenant_user_id'),
    details: text('details'),
    notes: text('notes'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_records_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_records_tenant_id_id_ux').on(t.tenantId, t.id),
    personCourseIdx: index('training_records_person_course_idx').on(
      t.tenantId,
      t.personId,
      t.courseId,
    ),
    courseIdx: index('training_records_course_idx').on(t.tenantId, t.courseId),
    classIdx: index('training_records_class_idx').on(t.tenantId, t.classId),
    activeClassPersonUx: uniqueIndex('training_records_active_class_person_ux')
      .on(t.tenantId, t.classId, t.personId)
      .where(
        sql`${t.classId} IS NOT NULL AND ${t.personId} IS NOT NULL AND ${t.deletedAt} IS NULL`,
      ),
    evaluatorIdx: index('training_records_evaluator_idx').on(t.tenantId, t.evaluatorPersonId),
    issuedByIdx: index('training_records_issued_by_idx').on(t.tenantId, t.issuedByTenantUserId),
    expiresIdx: index('training_records_expires_idx').on(t.tenantId, t.expiresOn),
    personFk: foreignKey({
      name: 'training_records_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    courseFk: foreignKey({
      name: 'training_records_tenant_course_fk',
      columns: [t.tenantId, t.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
    }),
    classFk: foreignKey({
      name: 'training_records_tenant_class_fk',
      columns: [t.tenantId, t.classId],
      foreignColumns: [trainingClasses.tenantId, trainingClasses.id],
    }),
    evaluatorFk: foreignKey({
      name: 'training_records_tenant_evaluator_fk',
      columns: [t.tenantId, t.evaluatorPersonId],
      foreignColumns: [people.tenantId, people.id],
    }),
    issuedByFk: foreignKey({
      name: 'training_records_tenant_issued_by_fk',
      columns: [t.tenantId, t.issuedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    gradeCheck: check(
      'training_records_grade_ck',
      sql`${t.grade} IS NULL OR (${t.grade} >= 0 AND ${t.grade} <= 100)`,
    ),
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
    recordId: uuid('record_id').notNull(),
    verifyToken: text('verify_token').notNull(), // public, opaque; resolves to record
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    ...timestamps,
  },
  (t) => ({
    recordIdx: uniqueIndex('training_certificates_record_id_ux').on(t.tenantId, t.recordId),
    tokenIdx: uniqueIndex('training_certificates_verify_token_ux').on(t.verifyToken),
    recordFk: foreignKey({
      name: 'training_certificates_tenant_record_fk',
      columns: [t.tenantId, t.recordId],
      foreignColumns: [trainingRecords.tenantId, trainingRecords.id],
    }).onDelete('cascade'),
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
