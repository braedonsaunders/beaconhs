// HazID / JSHA assessments — the per-job hazard-identification record itself.
//
// Each assessment is a snapshot of:
//   - General context (site, supervisor, occurred date, scope text, lock state)
//   - PPE rows (copied from the assessment-type defaults, plus per-job overrides)
//   - Question/Answer rows
//   - Task list (each task ties to a hazard-list + control text)
//   - Hazard list (with library link + standard + specific controls + applicability)
//   - Optional Working-at-Heights (WAH) sub-form
//   - Optional Confined Space sub-form (with diagram base64, atmospheric readings, entry log)
//   - Optional Arc Flash sub-form
//   - Signatures (internal employee + external visitor, with CS role flags)
//   - Photo attachments
//
// Mirrors the legacy HAZIDJSA* table family.

import { relations } from 'drizzle-orm'
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
import { attachments } from './attachments'
import { tenants, tenantUsers } from './core'
import {
  hazidAssessmentTypes,
  hazidAssessmentTypeApps,
  hazidHazards,
  hazidTasks,
  hazidQuestionType,
} from './hazid-libraries'
import { formResponses, formTemplates } from './forms'
import { orgUnits, people } from './org'

// ----------------------------------------------------------------------------
// Sub-form-related enums
// ----------------------------------------------------------------------------

export const hazidSignatureType = pgEnum('hazid_signature_type', ['internal', 'external'])
export const hazidPpeAnswer = pgEnum('hazid_ppe_answer', ['yes', 'no', 'na'])
export const hazidReviewStatus = pgEnum('hazid_review_status', ['pending', 'approved', 'rejected'])

// ----------------------------------------------------------------------------
// Assessment header
// ----------------------------------------------------------------------------
export const hazidAssessments = pgTable(
  'hazid_assessments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(), // e.g. HAZ-2026-00042

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),

    // Location
    // Nullable tenant-owned references use physical composite foreign keys
    // installed by migration SQL. PostgreSQL must clear only the business ID
    // on parent deletion; Drizzle cannot model partial-column SET NULL.
    siteOrgUnitId: uuid('site_org_unit_id'),
    locationOnSite: text('location_on_site'),
    projectOrgUnitId: uuid('project_org_unit_id'),

    // People
    supervisorTenantUserId: uuid('supervisor_tenant_user_id'),
    supervisorPersonId: uuid('supervisor_person_id'),
    reportedByTenantUserId: uuid('reported_by_tenant_user_id'),

    // Type + free-text scope
    assessmentTypeId: uuid('assessment_type_id'),
    jobScope: text('job_scope'),

    // NOTE: Working-at-Heights, Confined Space, and Arc Flash are no longer
    // native sub-forms — each is now a Builder App
    // (hazid-fall-protection-plan / hazid-confined-space-entry-plan /
    // hazid-arc-flash-work-plan) attached to the assessment type like any
    // other app, so they carry no columns on this table.

    // -------------------- Lock state -----------------------------------------
    inProgress: boolean('in_progress').default(true).notNull(),
    locked: boolean('locked').default(false).notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedByTenantUserId: uuid('locked_by_tenant_user_id'),

    // Safety review is advisory: it never locks the assessment or blocks field
    // work. Every decision is also written to the audit log for history.
    reviewStatus: hazidReviewStatus('review_status').default('pending').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedByTenantUserId: uuid('reviewed_by_tenant_user_id'),
    reviewNote: text('review_note'),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('hazid_assessments_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('hazid_assessments_tenant_id_id_ux').on(t.tenantId, t.id),
    referenceIdx: index('hazid_assessments_reference_idx').on(t.tenantId, t.reference),
    occurredIdx: index('hazid_assessments_occurred_idx').on(t.tenantId, t.occurredAt),
    siteIdx: index('hazid_assessments_site_idx').on(t.tenantId, t.siteOrgUnitId),
    projectIdx: index('hazid_assessments_project_idx').on(t.tenantId, t.projectOrgUnitId),
    typeIdx: index('hazid_assessments_type_idx').on(t.tenantId, t.assessmentTypeId),
    supervisorIdx: index('hazid_assessments_supervisor_idx').on(t.tenantId, t.supervisorPersonId),
    supervisorUserIdx: index('hazid_assessments_supervisor_user_idx').on(
      t.tenantId,
      t.supervisorTenantUserId,
    ),
    reportedByIdx: index('hazid_assessments_reported_by_idx').on(
      t.tenantId,
      t.reportedByTenantUserId,
    ),
    lockedByIdx: index('hazid_assessments_locked_by_idx').on(t.tenantId, t.lockedByTenantUserId),
    reviewIdx: index('hazid_assessments_review_idx').on(t.tenantId, t.reviewStatus, t.reviewedAt),
    lockedByFk: foreignKey({
      name: 'hazid_assessments_tenant_locked_by_user_fk',
      columns: [t.tenantId, t.lockedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    reviewedByFk: foreignKey({
      name: 'hazid_assessments_tenant_reviewed_by_user_fk',
      columns: [t.tenantId, t.reviewedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

// ----------------------------------------------------------------------------
// Assessment Tasks
// ----------------------------------------------------------------------------
export const hazidAssessmentTasks = pgTable(
  'hazid_assessment_tasks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull(),
    taskId: uuid('task_id'),
    description: text('description'), // override / ad-hoc task description
    // The hazard ids ("library refs") that this task introduces
    hazardIds: jsonb('hazard_ids').$type<string[]>().default([]).notNull(),
    controls: text('controls'),
    entityOrder: integer('entity_order').default(1).notNull(),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_tasks_assessment_idx').on(
      t.tenantId,
      t.assessmentId,
      t.entityOrder,
    ),
    taskIdx: index('hazid_assessment_tasks_task_idx').on(t.tenantId, t.taskId),
    tenantIdx: index('hazid_assessment_tasks_tenant_idx').on(t.tenantId),
    assessmentFk: foreignKey({
      name: 'hazid_assessment_tasks_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [hazidAssessments.tenantId, hazidAssessments.id],
    }).onDelete('cascade'),
  }),
)

// ----------------------------------------------------------------------------
// Assessment Hazards
//
// Risk ratings use the standard L×S = R 5×5 matrix. We store the pre-control
// scores (the inherent risk before mitigations) AND the post-control scores
// (the residual risk after the controls listed in `controls` are applied) so
// the assessment can show that controls actually reduce the risk. The score
// columns themselves are derived in app code from likelihood × severity rather
// than via a Postgres GENERATED column — keeps the migration simple and lets
// us treat missing inputs as "not yet rated" without funky NULL semantics.
// ----------------------------------------------------------------------------
export const hazidAssessmentHazards = pgTable(
  'hazid_assessment_hazards',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull(),
    hazardId: uuid('hazard_id'),
    name: text('name'), // override / ad-hoc hazard name
    standardControls: text('standard_controls'), // snapshotted from library at add-time
    specificControls: text('specific_controls'), // free-text per-job override
    applicable: boolean('applicable').default(true).notNull(),
    entityOrder: integer('entity_order').default(1).notNull(),
    // ---- Pre-control risk rating (inherent risk, no controls applied) -----
    preLikelihood: integer('pre_likelihood'), // 1-5
    preSeverity: integer('pre_severity'), // 1-5
    // ---- Controls applied to reduce risk -----------------------------------
    controls: text('controls'),
    // ---- Post-control risk rating (residual risk after controls) -----------
    postLikelihood: integer('post_likelihood'), // 1-5
    postSeverity: integer('post_severity'), // 1-5
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_hazards_assessment_idx').on(
      t.tenantId,
      t.assessmentId,
      t.entityOrder,
    ),
    hazardIdx: index('hazid_assessment_hazards_hazard_idx').on(t.tenantId, t.hazardId),
    tenantIdx: index('hazid_assessment_hazards_tenant_idx').on(t.tenantId),
    assessmentFk: foreignKey({
      name: 'hazid_assessment_hazards_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [hazidAssessments.tenantId, hazidAssessments.id],
    }).onDelete('cascade'),
  }),
)

// ----------------------------------------------------------------------------
// Assessment Signatures
// ----------------------------------------------------------------------------
export const hazidAssessmentSignatures = pgTable(
  'hazid_assessment_signatures',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull(),
    signatureType: hazidSignatureType('signature_type').notNull(),
    // Internal signers: link to person directory
    personId: uuid('person_id'),
    // External: free-text name
    externalName: text('external_name'),
    signatureAttachmentId: uuid('signature_attachment_id'),
    // Confined-space role flags — at least one must be true when CS is integrated
    csEntrant: boolean('cs_entrant').default(false).notNull(),
    csAttendant: boolean('cs_attendant').default(false).notNull(),
    csRescue: boolean('cs_rescue').default(false).notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_signatures_assessment_idx').on(
      t.tenantId,
      t.assessmentId,
    ),
    personIdx: index('hazid_assessment_signatures_person_idx').on(t.tenantId, t.personId),
    tenantIdx: index('hazid_assessment_signatures_tenant_idx').on(t.tenantId),
    assessmentFk: foreignKey({
      name: 'hazid_assessment_signatures_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [hazidAssessments.tenantId, hazidAssessments.id],
    }).onDelete('cascade'),
  }),
)

// ----------------------------------------------------------------------------
// Assessment PPE
// ----------------------------------------------------------------------------
export const hazidAssessmentPPE = pgTable(
  'hazid_assessment_ppe',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    required: boolean('required').default(true).notNull(),
    entityOrder: integer('entity_order').default(1).notNull(),
    answer: hazidPpeAnswer('answer'), // yes / no / na
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_ppe_assessment_idx').on(
      t.tenantId,
      t.assessmentId,
      t.entityOrder,
    ),
    tenantIdx: index('hazid_assessment_ppe_tenant_idx').on(t.tenantId),
    assessmentFk: foreignKey({
      name: 'hazid_assessment_ppe_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [hazidAssessments.tenantId, hazidAssessments.id],
    }).onDelete('cascade'),
  }),
)

// ----------------------------------------------------------------------------
// Assessment Q&A
// ----------------------------------------------------------------------------
export const hazidAssessmentQuestions = pgTable(
  'hazid_assessment_questions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull(),
    // Physical tenant-aware FK uses partial-column SET NULL in migration SQL.
    sourceTypeQuestionId: uuid('source_type_question_id'),
    question: text('question').notNull(),
    questionType: hazidQuestionType('question_type').default('yes_no').notNull(),
    answers: jsonb('answers').$type<string[]>().default([]).notNull(),
    requiresYes: boolean('requires_yes').default(false).notNull(),
    answer: text('answer'),
    entityOrder: integer('entity_order').default(1).notNull(),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_questions_assessment_idx').on(
      t.tenantId,
      t.assessmentId,
      t.entityOrder,
    ),
    tenantIdx: index('hazid_assessment_questions_tenant_idx').on(t.tenantId),
    sourceQuestionIdx: index('hazid_assessment_questions_source_question_idx').on(
      t.tenantId,
      t.sourceTypeQuestionId,
    ),
    assessmentFk: foreignKey({
      name: 'hazid_assessment_questions_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [hazidAssessments.tenantId, hazidAssessments.id],
    }).onDelete('cascade'),
  }),
)

// ----------------------------------------------------------------------------
// Assessment Photos
// ----------------------------------------------------------------------------
export const hazidAssessmentPhotos = pgTable(
  'hazid_assessment_photos',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull(),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_photos_assessment_idx').on(t.tenantId, t.assessmentId),
    assessmentOrderIdx: index('hazid_assessment_photos_assessment_order_idx').on(
      t.tenantId,
      t.assessmentId,
      t.sortOrder,
    ),
    tenantIdx: index('hazid_assessment_photos_tenant_idx').on(t.tenantId),
    assessmentFk: foreignKey({
      name: 'hazid_assessment_photos_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [hazidAssessments.tenantId, hazidAssessments.id],
    }).onDelete('cascade'),
  }),
)

// ----------------------------------------------------------------------------
// Embedded builder-app responses
// ----------------------------------------------------------------------------
// Each row links one form-builder response to this assessment. The app's shape
// comes from hazid_assessment_type_apps → form_templates; the response row
// stores draft/submitted data, workflow, scoring, signatures, and PDF state.
export const hazidAssessmentAppResponses = pgTable(
  'hazid_assessment_app_responses',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id').notNull(),
    // The physical composite FK is installed by migration SQL because
    // PostgreSQL must clear only type_app_id on delete; Drizzle cannot model
    // partial-column SET NULL for a composite key.
    typeAppId: uuid('type_app_id'),
    templateId: uuid('template_id').notNull(),
    responseId: uuid('response_id').notNull(),
    entityOrder: integer('entity_order').default(1).notNull(),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_app_responses_assessment_idx').on(
      t.tenantId,
      t.assessmentId,
      t.entityOrder,
    ),
    responseIdx: index('hazid_assessment_app_responses_response_idx').on(
      t.tenantId,
      t.templateId,
      t.responseId,
    ),
    typeAppIdx: index('hazid_assessment_app_responses_type_app_idx').on(
      t.tenantId,
      t.templateId,
      t.typeAppId,
    ),
    tenantIdx: index('hazid_assessment_app_responses_tenant_idx').on(t.tenantId),
    assessmentTypeAppUx: uniqueIndex('hazid_assessment_app_responses_assessment_type_app_ux').on(
      t.assessmentId,
      t.typeAppId,
    ),
    responseUx: uniqueIndex('hazid_assessment_app_responses_response_ux').on(t.responseId),
    templateFk: foreignKey({
      name: 'hazid_assessment_app_responses_tenant_template_fk',
      columns: [t.tenantId, t.templateId],
      foreignColumns: [formTemplates.tenantId, formTemplates.id],
    }).onDelete('cascade'),
    responseFk: foreignKey({
      name: 'hazid_assessment_app_responses_tenant_template_response_fk',
      columns: [t.tenantId, t.templateId, t.responseId],
      foreignColumns: [formResponses.tenantId, formResponses.templateId, formResponses.id],
    }).onDelete('cascade'),
    assessmentFk: foreignKey({
      name: 'hazid_assessment_app_responses_tenant_assessment_fk',
      columns: [t.tenantId, t.assessmentId],
      foreignColumns: [hazidAssessments.tenantId, hazidAssessments.id],
    }).onDelete('cascade'),
  }),
)

// NOTE: the native confined-space atmospheric-readings + entry-log tables were
// removed — confined space is now the hazid-confined-space-entry-plan Builder
// App, which stores its readings/entries in its own form response.

// ----------------------------------------------------------------------------
// Relations
// ----------------------------------------------------------------------------

export const hazidAssessmentsRelations = relations(hazidAssessments, ({ one, many }) => ({
  tenant: one(tenants, { fields: [hazidAssessments.tenantId], references: [tenants.id] }),
  site: one(orgUnits, {
    fields: [hazidAssessments.tenantId, hazidAssessments.siteOrgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
    relationName: 'hazid_assessment_site',
  }),
  project: one(orgUnits, {
    fields: [hazidAssessments.tenantId, hazidAssessments.projectOrgUnitId],
    references: [orgUnits.tenantId, orgUnits.id],
    relationName: 'hazid_assessment_project',
  }),
  supervisorPerson: one(people, {
    fields: [hazidAssessments.tenantId, hazidAssessments.supervisorPersonId],
    references: [people.tenantId, people.id],
  }),
  supervisorMember: one(tenantUsers, {
    fields: [hazidAssessments.tenantId, hazidAssessments.supervisorTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
    relationName: 'hazid_assessment_supervisor',
  }),
  reportedBy: one(tenantUsers, {
    fields: [hazidAssessments.tenantId, hazidAssessments.reportedByTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
    relationName: 'hazid_assessment_reporter',
  }),
  type: one(hazidAssessmentTypes, {
    fields: [hazidAssessments.tenantId, hazidAssessments.assessmentTypeId],
    references: [hazidAssessmentTypes.tenantId, hazidAssessmentTypes.id],
  }),
  lockedBy: one(tenantUsers, {
    fields: [hazidAssessments.tenantId, hazidAssessments.lockedByTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
    relationName: 'hazid_assessment_locker',
  }),
  tasks: many(hazidAssessmentTasks),
  hazards: many(hazidAssessmentHazards),
  signatures: many(hazidAssessmentSignatures),
  ppe: many(hazidAssessmentPPE),
  questions: many(hazidAssessmentQuestions),
  photos: many(hazidAssessmentPhotos),
  appResponses: many(hazidAssessmentAppResponses),
}))

export const hazidAssessmentTasksRelations = relations(hazidAssessmentTasks, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentTasks.tenantId], references: [tenants.id] }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentTasks.tenantId, hazidAssessmentTasks.assessmentId],
    references: [hazidAssessments.tenantId, hazidAssessments.id],
  }),
  task: one(hazidTasks, {
    fields: [hazidAssessmentTasks.tenantId, hazidAssessmentTasks.taskId],
    references: [hazidTasks.tenantId, hazidTasks.id],
  }),
}))

export const hazidAssessmentHazardsRelations = relations(hazidAssessmentHazards, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentHazards.tenantId], references: [tenants.id] }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentHazards.tenantId, hazidAssessmentHazards.assessmentId],
    references: [hazidAssessments.tenantId, hazidAssessments.id],
  }),
  hazard: one(hazidHazards, {
    fields: [hazidAssessmentHazards.tenantId, hazidAssessmentHazards.hazardId],
    references: [hazidHazards.tenantId, hazidHazards.id],
  }),
}))

export const hazidAssessmentSignaturesRelations = relations(
  hazidAssessmentSignatures,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [hazidAssessmentSignatures.tenantId],
      references: [tenants.id],
    }),
    assessment: one(hazidAssessments, {
      fields: [hazidAssessmentSignatures.tenantId, hazidAssessmentSignatures.assessmentId],
      references: [hazidAssessments.tenantId, hazidAssessments.id],
    }),
    person: one(people, {
      fields: [hazidAssessmentSignatures.tenantId, hazidAssessmentSignatures.personId],
      references: [people.tenantId, people.id],
    }),
  }),
)

export const hazidAssessmentPPERelations = relations(hazidAssessmentPPE, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentPPE.tenantId], references: [tenants.id] }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentPPE.tenantId, hazidAssessmentPPE.assessmentId],
    references: [hazidAssessments.tenantId, hazidAssessments.id],
  }),
}))

export const hazidAssessmentQuestionsRelations = relations(hazidAssessmentQuestions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [hazidAssessmentQuestions.tenantId],
    references: [tenants.id],
  }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentQuestions.tenantId, hazidAssessmentQuestions.assessmentId],
    references: [hazidAssessments.tenantId, hazidAssessments.id],
  }),
}))

export const hazidAssessmentPhotosRelations = relations(hazidAssessmentPhotos, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentPhotos.tenantId], references: [tenants.id] }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentPhotos.tenantId, hazidAssessmentPhotos.assessmentId],
    references: [hazidAssessments.tenantId, hazidAssessments.id],
  }),
  attachment: one(attachments, {
    fields: [hazidAssessmentPhotos.attachmentId],
    references: [attachments.id],
  }),
}))

export const hazidAssessmentAppResponsesRelations = relations(
  hazidAssessmentAppResponses,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [hazidAssessmentAppResponses.tenantId],
      references: [tenants.id],
    }),
    assessment: one(hazidAssessments, {
      fields: [hazidAssessmentAppResponses.tenantId, hazidAssessmentAppResponses.assessmentId],
      references: [hazidAssessments.tenantId, hazidAssessments.id],
    }),
    typeApp: one(hazidAssessmentTypeApps, {
      fields: [
        hazidAssessmentAppResponses.tenantId,
        hazidAssessmentAppResponses.templateId,
        hazidAssessmentAppResponses.typeAppId,
      ],
      references: [
        hazidAssessmentTypeApps.tenantId,
        hazidAssessmentTypeApps.templateId,
        hazidAssessmentTypeApps.id,
      ],
    }),
    template: one(formTemplates, {
      fields: [hazidAssessmentAppResponses.tenantId, hazidAssessmentAppResponses.templateId],
      references: [formTemplates.tenantId, formTemplates.id],
    }),
    response: one(formResponses, {
      fields: [
        hazidAssessmentAppResponses.tenantId,
        hazidAssessmentAppResponses.templateId,
        hazidAssessmentAppResponses.responseId,
      ],
      references: [formResponses.tenantId, formResponses.templateId, formResponses.id],
    }),
  }),
)
