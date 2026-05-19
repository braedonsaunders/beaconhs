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
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants, tenantUsers } from './core'
import {
  hazidAssessmentTypes,
  hazidHazards,
  hazidTasks,
  hazidQuestionType,
} from './hazid-libraries'
import { orgUnits, people } from './org'
import { atmosphericSensors } from './sensors'

// ----------------------------------------------------------------------------
// Sub-form-related enums
// ----------------------------------------------------------------------------

export const hazidCSType = pgEnum('hazid_cs_type', ['paper', 'integrated'])
export const hazidCSRescueStyle = pgEnum('hazid_cs_rescue_style', ['entry', 'non_entry'])
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

    // -------------------- Working-at-Heights ---------------------------------
    wah: boolean('wah').default(false).notNull(),
    wahType: text('wah_type'),
    wahCommunication: jsonb('wah_communication').$type<string[]>().default([]).notNull(),
    wahAccess: jsonb('wah_access').$type<string[]>().default([]).notNull(),
    wahEquipment: jsonb('wah_equipment').$type<string[]>().default([]).notNull(),
    wahRescue: text('wah_rescue'),
    wahPermitNumber: text('wah_permit_number'),

    // -------------------- Confined Space -------------------------------------
    confinedSpace: boolean('confined_space').default(false).notNull(),
    csType: hazidCSType('cs_type'),
    csDescription: text('cs_description'),
    csCommunication: jsonb('cs_communication').$type<string[]>().default([]).notNull(),
    csCommunicationRescue: jsonb('cs_communication_rescue').$type<string[]>().default([]).notNull(),
    csRescue: jsonb('cs_rescue').$type<string[]>().default([]).notNull(),
    csWorkPerformed: text('cs_work_performed'),
    csDiagramBase64: text('cs_diagram_base64'),
    csRescueStyle: hazidCSRescueStyle('cs_rescue_style'),
    csRescueProcedure: text('cs_rescue_procedure'),
    csAtmosphericSensorId: uuid('cs_atmospheric_sensor_id').references(
      () => atmosphericSensors.id,
      { onDelete: 'set null' },
    ),
    csPermitNumber: text('cs_permit_number'),

    // -------------------- Arc Flash ------------------------------------------
    arcFlash: boolean('arc_flash').default(false).notNull(),
    arcFlashLevel: text('arc_flash_level'),
    arcFlashBoundary: text('arc_flash_boundary'),
    arcFlashIncidentEnergy: text('arc_flash_incident_energy'),
    arcFlashEquipment: jsonb('arc_flash_equipment').$type<string[]>().default([]).notNull(),
    arcFlashProcedures: text('arc_flash_procedures'),
    arcFlashQualifiedPerson: text('arc_flash_qualified_person'),

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
    assessmentIdx: index('hazid_assessment_tasks_assessment_idx').on(
      t.assessmentId,
      t.entityOrder,
    ),
    tenantIdx: index('hazid_assessment_tasks_tenant_idx').on(t.tenantId),
  }),
)

// ----------------------------------------------------------------------------
// Assessment Hazards
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
    // Captured signature data URL (PNG)
    signatureDataUrl: text('signature_data_url'),
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
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    caption: text('caption'),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_photos_assessment_idx').on(t.assessmentId),
    tenantIdx: index('hazid_assessment_photos_tenant_idx').on(t.tenantId),
  }),
)

// ----------------------------------------------------------------------------
// Confined-space atmospheric readings
// ----------------------------------------------------------------------------
export const hazidAssessmentCSAtmospheric = pgTable(
  'hazid_assessment_cs_atmospheric',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
    atmosphericSensorId: uuid('atmospheric_sensor_id').references(() => atmosphericSensors.id, {
      onDelete: 'set null',
    }),
    time: timestamp('time', { withTimezone: true }).notNull(),
    sensor1Reading: numeric('sensor_1_reading'),
    sensor2Reading: numeric('sensor_2_reading'),
    sensor3Reading: numeric('sensor_3_reading'),
    sensor4Reading: numeric('sensor_4_reading'),
    distance: text('distance'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_cs_atmospheric_assessment_idx').on(t.assessmentId),
    tenantIdx: index('hazid_assessment_cs_atmospheric_tenant_idx').on(t.tenantId),
  }),
)

// ----------------------------------------------------------------------------
// Confined-space entry log
// ----------------------------------------------------------------------------
export const hazidAssessmentCSEntries = pgTable(
  'hazid_assessment_cs_entries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => hazidAssessments.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').references(() => people.id, { onDelete: 'set null' }),
    externalName: text('external_name'),
    timeIn: timestamp('time_in', { withTimezone: true }),
    timeOut: timestamp('time_out', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    assessmentIdx: index('hazid_assessment_cs_entries_assessment_idx').on(t.assessmentId),
    tenantIdx: index('hazid_assessment_cs_entries_tenant_idx').on(t.tenantId),
  }),
)

// ----------------------------------------------------------------------------
// Signed report bundles — list of completed assessments combined into one PDF.
// ----------------------------------------------------------------------------
export const hazidSignedReportStatus = pgEnum('hazid_signed_report_status', [
  'pending',
  'generating',
  'ready',
  'failed',
])

export const hazidSignedReports = pgTable(
  'hazid_signed_reports',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    // Array of assessment ids included in the bundle.
    assessmentIds: jsonb('assessment_ids').$type<string[]>().default([]).notNull(),
    // Snapshot of recipients for audit.
    recipientEmails: jsonb('recipient_emails').$type<string[]>().default([]).notNull(),
    status: hazidSignedReportStatus('status').default('pending').notNull(),
    pdfAttachmentId: uuid('pdf_attachment_id').references(() => attachments.id, {
      onDelete: 'set null',
    }),
    builtByTenantUserId: uuid('built_by_tenant_user_id').references(() => tenantUsers.id),
    builtAt: timestamp('built_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('hazid_signed_reports_tenant_idx').on(t.tenantId),
    statusIdx: index('hazid_signed_reports_status_idx').on(t.tenantId, t.status),
  }),
)

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
  atmosphericSensor: one(atmosphericSensors, {
    fields: [hazidAssessments.csAtmosphericSensorId],
    references: [atmosphericSensors.id],
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
  atmosphericReadings: many(hazidAssessmentCSAtmospheric),
  entries: many(hazidAssessmentCSEntries),
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

export const hazidAssessmentQuestionsRelations = relations(
  hazidAssessmentQuestions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [hazidAssessmentQuestions.tenantId],
      references: [tenants.id],
    }),
    assessment: one(hazidAssessments, {
      fields: [hazidAssessmentQuestions.assessmentId],
      references: [hazidAssessments.id],
    }),
  }),
)

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

export const hazidAssessmentCSAtmosphericRelations = relations(
  hazidAssessmentCSAtmospheric,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [hazidAssessmentCSAtmospheric.tenantId],
      references: [tenants.id],
    }),
    assessment: one(hazidAssessments, {
      fields: [hazidAssessmentCSAtmospheric.assessmentId],
      references: [hazidAssessments.id],
    }),
    sensor: one(atmosphericSensors, {
      fields: [hazidAssessmentCSAtmospheric.atmosphericSensorId],
      references: [atmosphericSensors.id],
    }),
  }),
)

export const hazidAssessmentCSEntriesRelations = relations(
  hazidAssessmentCSEntries,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [hazidAssessmentCSEntries.tenantId],
      references: [tenants.id],
    }),
    assessment: one(hazidAssessments, {
      fields: [hazidAssessmentCSEntries.assessmentId],
      references: [hazidAssessments.id],
    }),
    person: one(people, {
      fields: [hazidAssessmentCSEntries.personId],
      references: [people.id],
    }),
  }),
)

export const hazidSignedReportsRelations = relations(hazidSignedReports, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidSignedReports.tenantId], references: [tenants.id] }),
  pdfAttachment: one(attachments, {
    fields: [hazidSignedReports.pdfAttachmentId],
    references: [attachments.id],
  }),
  builtBy: one(tenantUsers, {
    fields: [hazidSignedReports.builtByTenantUserId],
    references: [tenantUsers.id],
  }),
}))
