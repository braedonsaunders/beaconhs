// Training-module add-ons:
//
//   • training_course_files   — attachments tied to a course (study material,
//                                handouts, PDFs, videos).  Distinct from the
//                                `material_attachment_ids` JSON column on
//                                training_courses, which the new platform may
//                                drop later — this table is the persistent
//                                home for course assets.
//   • training_extra_fields   — polymorphic key/value pairs attached to a
//                                training_skill, training_skill_type, or
//                                training_skill_authority.  Replaces the
//                                three legacy `*_additional` tables.
//
// Polymorphic ownership is modelled with an enum + uuid pair.  We do NOT add a
// real FK on owner_id since the referenced table varies — application code is
// responsible for cascading on delete (or accepting the orphaned row).

import { relations } from 'drizzle-orm'
import { index, integer, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants } from './core'
import { trainingCourses } from './training'

// ---------------------------------------------------------------------------
// training_course_files
// ---------------------------------------------------------------------------

export const trainingCourseFiles = pgTable(
  'training_course_files',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    courseId: uuid('course_id')
      .notNull()
      .references(() => trainingCourses.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').references(() => attachments.id, {
      onDelete: 'set null',
    }),
    label: text('label'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_course_files_tenant_idx').on(t.tenantId),
    courseIdx: index('training_course_files_course_idx').on(t.courseId),
  }),
)

export const trainingCourseFilesRelations = relations(trainingCourseFiles, ({ one }) => ({
  tenant: one(tenants, {
    fields: [trainingCourseFiles.tenantId],
    references: [tenants.id],
  }),
  course: one(trainingCourses, {
    fields: [trainingCourseFiles.courseId],
    references: [trainingCourses.id],
  }),
  attachment: one(attachments, {
    fields: [trainingCourseFiles.attachmentId],
    references: [attachments.id],
  }),
}))

// ---------------------------------------------------------------------------
// training_extra_fields
// ---------------------------------------------------------------------------

export const trainingExtraFieldOwnerType = pgEnum('training_extra_field_owner_type', [
  'skill',
  'skill_type',
  'authority',
])

export type TrainingExtraFieldOwnerType = (typeof trainingExtraFieldOwnerType.enumValues)[number]

export const trainingExtraFields = pgTable(
  'training_extra_fields',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    ownerType: trainingExtraFieldOwnerType('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    fieldKey: text('field_key').notNull(),
    fieldValue: text('field_value'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_extra_fields_tenant_idx').on(t.tenantId),
    ownerIdx: index('training_extra_fields_owner_idx').on(t.ownerType, t.ownerId),
  }),
)

export const trainingExtraFieldsRelations = relations(trainingExtraFields, ({ one }) => ({
  tenant: one(tenants, {
    fields: [trainingExtraFields.tenantId],
    references: [tenants.id],
  }),
}))
