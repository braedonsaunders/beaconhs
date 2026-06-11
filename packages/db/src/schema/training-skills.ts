// Training Skill Authority — competency hierarchy.
//
// Authority (e.g. "Boilermakers Local 128") issues Skill Types
// (e.g. "Pressure Welding Certification"); a Skill Assignment is the
// per-person grant of that skill, with optional expiry.
//
// This is intentionally separate from the on-the-job `trainingSkills` /
// `trainingSkillEvaluations` already in `training.ts` — those model evaluator
// sign-off of in-house competencies; this models externally-issued credentials.

import { relations } from 'drizzle-orm'
import { date, index, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants, tenantUsers } from './core'
import { people } from './org'

export const trainingSkillAuthorities = pgTable(
  'training_skill_authorities',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    jurisdiction: text('jurisdiction'), // 'Ontario' | 'Federal' | 'Internal' | …
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_skill_authorities_tenant_idx').on(t.tenantId),
    tenantCodeIdx: index('training_skill_authorities_tenant_code_idx').on(t.tenantId, t.code),
  }),
)

export const trainingSkillTypes = pgTable(
  'training_skill_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    authorityId: uuid('authority_id')
      .notNull()
      .references(() => trainingSkillAuthorities.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code'),
    validForMonths: integer('valid_for_months'), // null = no expiry
    description: text('description'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_skill_types_tenant_idx').on(t.tenantId),
    authorityIdx: index('training_skill_types_authority_idx').on(t.authorityId),
  }),
)

export const trainingSkillAssignments = pgTable(
  'training_skill_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    skillTypeId: uuid('skill_type_id')
      .notNull()
      .references(() => trainingSkillTypes.id, { onDelete: 'cascade' }),
    grantedOn: date('granted_on').notNull(),
    expiresOn: date('expires_on'),
    grantedByTenantUserId: uuid('granted_by_tenant_user_id').references(() => tenantUsers.id),
    evidenceAttachmentId: uuid('evidence_attachment_id').references(() => attachments.id),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_skill_assignments_tenant_idx').on(t.tenantId),
    personIdx: index('training_skill_assignments_person_idx').on(t.tenantId, t.personId),
    skillTypeIdx: index('training_skill_assignments_skill_type_idx').on(t.skillTypeId),
    expiresIdx: index('training_skill_assignments_expires_idx').on(t.tenantId, t.expiresOn),
  }),
)

export const trainingSkillAuthoritiesRelations = relations(
  trainingSkillAuthorities,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [trainingSkillAuthorities.tenantId],
      references: [tenants.id],
    }),
    skillTypes: many(trainingSkillTypes),
  }),
)

export const trainingSkillTypesRelations = relations(trainingSkillTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [trainingSkillTypes.tenantId], references: [tenants.id] }),
  authority: one(trainingSkillAuthorities, {
    fields: [trainingSkillTypes.authorityId],
    references: [trainingSkillAuthorities.id],
  }),
  assignments: many(trainingSkillAssignments),
}))

export const trainingSkillAssignmentsRelations = relations(trainingSkillAssignments, ({ one }) => ({
  tenant: one(tenants, { fields: [trainingSkillAssignments.tenantId], references: [tenants.id] }),
  person: one(people, {
    fields: [trainingSkillAssignments.personId],
    references: [people.id],
  }),
  skillType: one(trainingSkillTypes, {
    fields: [trainingSkillAssignments.skillTypeId],
    references: [trainingSkillTypes.id],
  }),
  grantedBy: one(tenantUsers, {
    fields: [trainingSkillAssignments.grantedByTenantUserId],
    references: [tenantUsers.id],
  }),
  evidence: one(attachments, {
    fields: [trainingSkillAssignments.evidenceAttachmentId],
    references: [attachments.id],
  }),
}))
