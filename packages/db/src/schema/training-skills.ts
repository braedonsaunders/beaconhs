// Training Skill Authority — competency hierarchy.
//
// Authority (e.g. "Boilermakers Local 128") issues Skill Types
// (e.g. "Pressure Welding Certification"); a Skill Assignment is the
// per-person grant of that skill, with optional expiry.
//
// This is intentionally separate from the on-the-job `trainingSkills` /
// `trainingSkillEvaluations` already in `training.ts` — those model evaluator
// sign-off of in-house competencies; this models externally-issued credentials.

import { relations, sql } from 'drizzle-orm'
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants, tenantUsers, users } from './core'
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
    tenantIdIdUx: uniqueIndex('training_skill_authorities_tenant_id_id_ux').on(t.tenantId, t.id),
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
    authorityId: uuid('authority_id').notNull(),
    name: text('name').notNull(),
    code: text('code'),
    validForMonths: integer('valid_for_months'), // null = no expiry
    description: text('description'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_skill_types_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_skill_types_tenant_id_id_ux').on(t.tenantId, t.id),
    authorityIdx: index('training_skill_types_authority_idx').on(t.tenantId, t.authorityId),
    authorityFk: foreignKey({
      name: 'training_skill_types_tenant_authority_fk',
      columns: [t.tenantId, t.authorityId],
      foreignColumns: [trainingSkillAuthorities.tenantId, trainingSkillAuthorities.id],
    }).onDelete('cascade'),
  }),
)

export const trainingSkillAssignments = pgTable(
  'training_skill_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Nullable so "New skill" can land on a genuinely blank draft (no defaulted
    // person/skill type that looks pre-existing). Lists filter out drafts where
    // either is still null. Mirrors the hazid draft model.
    personId: uuid('person_id'),
    skillTypeId: uuid('skill_type_id'),
    grantedOn: date('granted_on').notNull(),
    expiresOn: date('expires_on'),
    grantedByTenantUserId: uuid('granted_by_tenant_user_id'),
    evidenceAttachmentId: uuid('evidence_attachment_id'),
    notes: text('notes'),
    ...timestamps,
    // Soft-delete so a skill is revoked (not hard-deleted) — same audit-safe
    // lifecycle as training_records certificates.
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('training_skill_assignments_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('training_skill_assignments_tenant_id_id_ux').on(t.tenantId, t.id),
    personIdx: index('training_skill_assignments_person_idx').on(t.tenantId, t.personId),
    skillTypeIdx: index('training_skill_assignments_skill_type_idx').on(t.tenantId, t.skillTypeId),
    grantedByIdx: index('training_skill_assignments_granted_by_idx').on(
      t.tenantId,
      t.grantedByTenantUserId,
    ),
    expiresIdx: index('training_skill_assignments_expires_idx').on(t.tenantId, t.expiresOn),
    personFk: foreignKey({
      name: 'training_skill_assignments_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    skillTypeFk: foreignKey({
      name: 'training_skill_assignments_tenant_skill_type_fk',
      columns: [t.tenantId, t.skillTypeId],
      foreignColumns: [trainingSkillTypes.tenantId, trainingSkillTypes.id],
    }).onDelete('cascade'),
    grantedByFk: foreignKey({
      name: 'training_skill_assignments_tenant_granted_by_fk',
      columns: [t.tenantId, t.grantedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

// Issued skill certificate (PDF + QR-verifiable token). Mirrors
// training_certificates, keyed on the skill assignment instead of the
// training record. Rows are created lazily on first certificate/wallet-card
// request for an assignment.
export const trainingSkillCertificates = pgTable(
  'training_skill_certificates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    skillAssignmentId: uuid('skill_assignment_id').notNull(),
    verifyToken: text('verify_token').notNull(), // public, opaque; resolves to assignment
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    ...timestamps,
  },
  (t) => ({
    assignmentIdx: uniqueIndex('training_skill_certificates_skill_assignment_id_ux').on(
      t.tenantId,
      t.skillAssignmentId,
    ),
    tokenIdx: uniqueIndex('training_skill_certificates_verify_token_ux').on(t.verifyToken),
    assignmentFk: foreignKey({
      name: 'training_skill_certificates_tenant_assignment_fk',
      columns: [t.tenantId, t.skillAssignmentId],
      foreignColumns: [trainingSkillAssignments.tenantId, trainingSkillAssignments.id],
    }).onDelete('cascade'),
  }),
)

// Supporting files uploaded against a skill assignment — scanned certificate,
// renewal letter, ID copy, proof-of-competency photos, etc. Mirrors
// `person_files`: a per-assignment index over the raw `attachments` row with a
// human label + `kind` tag, cascade-deleted with the assignment while the
// underlying attachment stays put for the audit trail.
export const trainingSkillAssignmentFiles = pgTable(
  'training_skill_assignment_files',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    skillAssignmentId: uuid('skill_assignment_id').notNull(),
    attachmentId: uuid('attachment_id'),
    label: text('label').notNull(),
    kind: text('kind').notNull(), // 'certificate' | 'evidence' | 'photo' | 'other'
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
    uploadedBy: text('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('training_skill_assignment_files_tenant_idx').on(t.tenantId),
    assignmentIdx: index('training_skill_assignment_files_assignment_idx').on(
      t.tenantId,
      t.skillAssignmentId,
    ),
    kindIdx: index('training_skill_assignment_files_kind_idx').on(t.tenantId, t.kind),
    assignmentFk: foreignKey({
      name: 'training_skill_assignment_files_tenant_assignment_fk',
      columns: [t.tenantId, t.skillAssignmentId],
      foreignColumns: [trainingSkillAssignments.tenantId, trainingSkillAssignments.id],
    }).onDelete('cascade'),
    kindCheck: check(
      'training_skill_assignment_files_kind_ck',
      sql`${t.kind} IN ('certificate', 'evidence', 'photo', 'other')`,
    ),
  }),
)

export const trainingSkillAssignmentFilesRelations = relations(
  trainingSkillAssignmentFiles,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [trainingSkillAssignmentFiles.tenantId],
      references: [tenants.id],
    }),
    assignment: one(trainingSkillAssignments, {
      fields: [trainingSkillAssignmentFiles.skillAssignmentId],
      references: [trainingSkillAssignments.id],
    }),
    attachment: one(attachments, {
      fields: [trainingSkillAssignmentFiles.attachmentId],
      references: [attachments.id],
    }),
    uploader: one(users, {
      fields: [trainingSkillAssignmentFiles.uploadedBy],
      references: [users.id],
    }),
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

export const trainingSkillCertificatesRelations = relations(
  trainingSkillCertificates,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [trainingSkillCertificates.tenantId],
      references: [tenants.id],
    }),
    assignment: one(trainingSkillAssignments, {
      fields: [trainingSkillCertificates.skillAssignmentId],
      references: [trainingSkillAssignments.id],
    }),
  }),
)

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
