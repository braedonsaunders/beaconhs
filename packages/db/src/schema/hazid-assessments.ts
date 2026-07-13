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
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id, {
      onDelete: 'set null',
    }),
    locationOnSite: text('location_on_site'),
    projectOrgUnitId: uuid('project_org_unit_id').references(() => orgUnits.id, {
      onDelete: 'set null',
    }),

    // People
    supervisorTenantUserId: uuid('supervisor_tenant_user_id').references(() => tenantUsers.id, {
      onDelete: 'set null',
    }),
    supervisorPersonId: uuid('supervisor_person_id').references(() => people.id, {
      onDelete: 'set null',
    }),
    reportedByTenantUserId: uuid('reported_by_tenant_user_id').references(() => tenantUsers.id, {
      onDelete: 'set null',
    }),

    // Type + free-text scope
    assessmentTypeId: uuid('assessment_type_id').references(() => hazidAssessmentTypes.id, {
      onDelete: 'set null',
    }),
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
    lockedByTenantUserId: uuid('locked_by_tenant_user_id').references(() => tenantUsers.id),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('hazid_assessments_tenant_idx').on(t.tenantId),
    referenceIdx: index('hazid_assessments_reference_idx').on(t.tenantId, t.reference),
    occurredIdx: index('hazid_assessments_occurred_idx').on(t.tenantId, t.occurredAt),
    siteIdx: index('hazid_assessments_site_idx').on(t.tenantId, t.siteOrgUnitId),
    typeIdx: index('hazid_assessments_type_idx').on(t.tenantId, t.assessmentTypeId),
    supervisorIdx: index('hazid_assessments_supervisor_idx').on(t.tenantId, t.supervisorPersonId),
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
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => hazidTasks.id, { onDelete: 'set null' }),
    description: text('description'), // override / ad-hoc task description
    // The hazard ids ("library refs") that this task introduces
    hazardIds: jsonb('hazard_ids').$type<string[]>().default([]).notNull(),
    controls: text('controls'),
    entityOrder: integer('entity_order').default(1).notNull(),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_tasks_assessment_idx').on(t.assessmentId, t.entityOrder),
    tenantIdx: index('hazid_assessment_tasks_tenant_idx').on(t.tenantId),
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
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
    hazardId: uuid('hazard_id').references(() => hazidHazards.id, { onDelete: 'set null' }),
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
      t.assessmentId,
      t.entityOrder,
    ),
    tenantIdx: index('hazid_assessment_hazards_tenant_idx').on(t.tenantId),
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
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
    signatureType: hazidSignatureType('signature_type').notNull(),
    // Internal signers: link to person directory
    personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),
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
    assessmentIdx: index('hazid_assessment_signatures_assessment_idx').on(t.assessmentId),
    tenantIdx: index('hazid_assessment_signatures_tenant_idx').on(t.tenantId),
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
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    required: boolean('required').default(true).notNull(),
    entityOrder: integer('entity_order').default(1).notNull(),
    answer: hazidPpeAnswer('answer'), // yes / no / na
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_ppe_assessment_idx').on(t.assessmentId, t.entityOrder),
    tenantIdx: index('hazid_assessment_ppe_tenant_idx').on(t.tenantId),
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
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
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
      t.assessmentId,
      t.entityOrder,
    ),
    tenantIdx: index('hazid_assessment_questions_tenant_idx').on(t.tenantId),
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
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id').notNull(),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_photos_assessment_idx').on(t.assessmentId),
    tenantIdx: index('hazid_assessment_photos_tenant_idx').on(t.tenantId),
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
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
    typeAppId: uuid('type_app_id').references(() => hazidAssessmentTypeApps.id, {
      onDelete: 'set null',
    }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => formTemplates.id, { onDelete: 'cascade' }),
    responseId: uuid('response_id')
      .notNull()
      .references(() => formResponses.id, { onDelete: 'cascade' }),
    entityOrder: integer('entity_order').default(1).notNull(),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_app_responses_assessment_idx').on(
      t.assessmentId,
      t.entityOrder,
    ),
    responseIdx: index('hazid_assessment_app_responses_response_idx').on(t.responseId),
    tenantIdx: index('hazid_assessment_app_responses_tenant_idx').on(t.tenantId),
    assessmentTypeAppUx: uniqueIndex('hazid_assessment_app_responses_assessment_type_app_ux').on(
      t.assessmentId,
      t.typeAppId,
    ),
    responseUx: uniqueIndex('hazid_assessment_app_responses_response_ux').on(t.responseId),
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
    fields: [hazidAssessments.siteOrgUnitId],
    references: [orgUnits.id],
    relationName: 'hazid_assessment_site',
  }),
  project: one(orgUnits, {
    fields: [hazidAssessments.projectOrgUnitId],
    references: [orgUnits.id],
    relationName: 'hazid_assessment_project',
  }),
  supervisorPerson: one(people, {
    fields: [hazidAssessments.supervisorPersonId],
    references: [people.id],
  }),
  supervisorMember: one(tenantUsers, {
    fields: [hazidAssessments.supervisorTenantUserId],
    references: [tenantUsers.id],
    relationName: 'hazid_assessment_supervisor',
  }),
  reportedBy: one(tenantUsers, {
    fields: [hazidAssessments.reportedByTenantUserId],
    references: [tenantUsers.id],
    relationName: 'hazid_assessment_reporter',
  }),
  type: one(hazidAssessmentTypes, {
    fields: [hazidAssessments.assessmentTypeId],
    references: [hazidAssessmentTypes.id],
  }),
  lockedBy: one(tenantUsers, {
    fields: [hazidAssessments.lockedByTenantUserId],
    references: [tenantUsers.id],
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
    fields: [hazidAssessmentTasks.assessmentId],
    references: [hazidAssessments.id],
  }),
  task: one(hazidTasks, {
    fields: [hazidAssessmentTasks.taskId],
    references: [hazidTasks.id],
  }),
}))

export const hazidAssessmentHazardsRelations = relations(hazidAssessmentHazards, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentHazards.tenantId], references: [tenants.id] }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentHazards.assessmentId],
    references: [hazidAssessments.id],
  }),
  hazard: one(hazidHazards, {
    fields: [hazidAssessmentHazards.hazardId],
    references: [hazidHazards.id],
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
      fields: [hazidAssessmentSignatures.assessmentId],
      references: [hazidAssessments.id],
    }),
    person: one(people, {
      fields: [hazidAssessmentSignatures.personId],
      references: [people.id],
    }),
  }),
)

export const hazidAssessmentPPERelations = relations(hazidAssessmentPPE, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentPPE.tenantId], references: [tenants.id] }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentPPE.assessmentId],
    references: [hazidAssessments.id],
  }),
}))

export const hazidAssessmentQuestionsRelations = relations(hazidAssessmentQuestions, ({ one }) => ({
  tenant: one(tenants, {
    fields: [hazidAssessmentQuestions.tenantId],
    references: [tenants.id],
  }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentQuestions.assessmentId],
    references: [hazidAssessments.id],
  }),
}))

export const hazidAssessmentPhotosRelations = relations(hazidAssessmentPhotos, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentPhotos.tenantId], references: [tenants.id] }),
  assessment: one(hazidAssessments, {
    fields: [hazidAssessmentPhotos.assessmentId],
    references: [hazidAssessments.id],
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
      fields: [hazidAssessmentAppResponses.assessmentId],
      references: [hazidAssessments.id],
    }),
    typeApp: one(hazidAssessmentTypeApps, {
      fields: [hazidAssessmentAppResponses.typeAppId],
      references: [hazidAssessmentTypeApps.id],
    }),
    template: one(formTemplates, {
      fields: [hazidAssessmentAppResponses.templateId],
      references: [formTemplates.id],
    }),
    response: one(formResponses, {
      fields: [hazidAssessmentAppResponses.responseId],
      references: [formResponses.id],
    }),
  }),
)
