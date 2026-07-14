// Training-module add-ons:
//
//   • training_course_files   — canonical attachments tied to a course (study
//                                material, handouts, PDFs, and videos).
//   • training_extra_fields   — key/value pairs attached to exactly one skill
//                                assignment, skill type, or authority. Separate
//                                nullable tenant-aware foreign keys preserve
//                                physical ownership and cascade cleanup.

import { relations, sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants } from './core'
import { trainingCourses } from './training'
import {
  trainingSkillAssignments,
  trainingSkillAuthorities,
  trainingSkillTypes,
} from './training-skills'

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
    courseId: uuid('course_id').notNull(),
    attachmentId: uuid('attachment_id'),
    label: text('label'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_course_files_tenant_idx').on(t.tenantId),
    courseIdx: index('training_course_files_course_idx').on(t.tenantId, t.courseId),
    courseFk: foreignKey({
      name: 'training_course_files_tenant_course_fk',
      columns: [t.tenantId, t.courseId],
      foreignColumns: [trainingCourses.tenantId, trainingCourses.id],
    }).onDelete('cascade'),
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

export const trainingExtraFields = pgTable(
  'training_extra_fields',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    skillAssignmentId: uuid('skill_assignment_id'),
    skillTypeId: uuid('skill_type_id'),
    authorityId: uuid('authority_id'),
    fieldKey: text('field_key').notNull(),
    fieldValue: text('field_value'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_extra_fields_tenant_idx').on(t.tenantId),
    skillAssignmentIdx: index('training_extra_fields_skill_assignment_idx').on(
      t.tenantId,
      t.skillAssignmentId,
    ),
    skillTypeIdx: index('training_extra_fields_skill_type_idx').on(t.tenantId, t.skillTypeId),
    authorityIdx: index('training_extra_fields_authority_idx').on(t.tenantId, t.authorityId),
    skillAssignmentKeyUx: uniqueIndex('training_extra_fields_skill_assignment_key_ux')
      .on(t.tenantId, t.skillAssignmentId, sql`lower(${t.fieldKey})`)
      .where(sql`${t.skillAssignmentId} IS NOT NULL`),
    skillTypeKeyUx: uniqueIndex('training_extra_fields_skill_type_key_ux')
      .on(t.tenantId, t.skillTypeId, sql`lower(${t.fieldKey})`)
      .where(sql`${t.skillTypeId} IS NOT NULL`),
    authorityKeyUx: uniqueIndex('training_extra_fields_authority_key_ux')
      .on(t.tenantId, t.authorityId, sql`lower(${t.fieldKey})`)
      .where(sql`${t.authorityId} IS NOT NULL`),
    skillAssignmentFk: foreignKey({
      name: 'training_extra_fields_tenant_skill_assignment_fk',
      columns: [t.tenantId, t.skillAssignmentId],
      foreignColumns: [trainingSkillAssignments.tenantId, trainingSkillAssignments.id],
    }).onDelete('cascade'),
    skillTypeFk: foreignKey({
      name: 'training_extra_fields_tenant_skill_type_fk',
      columns: [t.tenantId, t.skillTypeId],
      foreignColumns: [trainingSkillTypes.tenantId, trainingSkillTypes.id],
    }).onDelete('cascade'),
    authorityFk: foreignKey({
      name: 'training_extra_fields_tenant_authority_fk',
      columns: [t.tenantId, t.authorityId],
      foreignColumns: [trainingSkillAuthorities.tenantId, trainingSkillAuthorities.id],
    }).onDelete('cascade'),
    exactlyOneOwnerCk: check(
      'training_extra_fields_exactly_one_owner_ck',
      sql`num_nonnulls(${t.skillAssignmentId}, ${t.skillTypeId}, ${t.authorityId}) = 1`,
    ),
  }),
)

export const trainingExtraFieldsRelations = relations(trainingExtraFields, ({ one }) => ({
  tenant: one(tenants, {
    fields: [trainingExtraFields.tenantId],
    references: [tenants.id],
  }),
  skillAssignment: one(trainingSkillAssignments, {
    fields: [trainingExtraFields.skillAssignmentId],
    references: [trainingSkillAssignments.id],
  }),
  skillType: one(trainingSkillTypes, {
    fields: [trainingExtraFields.skillTypeId],
    references: [trainingSkillTypes.id],
  }),
  authority: one(trainingSkillAuthorities, {
    fields: [trainingExtraFields.authorityId],
    references: [trainingSkillAuthorities.id],
  }),
}))
