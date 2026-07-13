// HazID / JSHA library catalogues — admin-curated reference data that drives
// the per-job assessment workflow.
//
//   hazid_hazard_types         Color-coded grouping (Chemical, Mechanical, etc).
//   hazid_hazards              The hazard bank itself (Name, type, standard controls).
//   hazid_hazard_sets          Named bundles of hazards (one-click bulk-add to an assessment).
//   hazid_tasks                Task bank — reusable task description + default hazards/controls.
//   hazid_location_tasks       Per-site default task list (auto-suggest on new assessment).
//   hazid_assessment_types     "Standard JSHA", "Confined Space JSHA", "Arc Flash JSHA"...
//   hazid_assessment_type_ppe  Default PPE rows created when a new assessment of this type is opened.
//   hazid_assessment_type_questions  Default Q&A rows.

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants } from './core'
import { formTemplates } from './forms'
import { orgUnits } from './org'

// ----------------------------------------------------------------------------
// Hazard types — color-coded categories (chemical, mechanical, electrical...)
// ----------------------------------------------------------------------------
export const hazidHazardTypes = pgTable(
  'hazid_hazard_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color').default('#64748b').notNull(), // tailwind slate-500
    iconKey: text('icon_key'), // lucide icon name, e.g. 'flame', 'zap'
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('hazid_hazard_types_tenant_idx').on(t.tenantId),
    tenantNameUx: uniqueIndex('hazid_hazard_types_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

// ----------------------------------------------------------------------------
// Hazard library
// ----------------------------------------------------------------------------
export const hazidHazards = pgTable(
  'hazid_hazards',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    hazardTypeId: uuid('hazard_type_id').references(() => hazidHazardTypes.id, {
      onDelete: 'set null',
    }),
    standardControls: text('standard_controls'), // the canonical control text
    risks: text('risks'), // optional "what could go wrong" copy
    photoAttachmentId: uuid('photo_attachment_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('hazid_hazards_tenant_idx').on(t.tenantId),
    nameIdx: index('hazid_hazards_name_idx').on(t.tenantId, t.name),
    typeIdx: index('hazid_hazards_type_idx').on(t.tenantId, t.hazardTypeId),
  }),
)

// ----------------------------------------------------------------------------
// Hazard sets — named bundles for bulk-add
// ----------------------------------------------------------------------------
export const hazidHazardSets = pgTable(
  'hazid_hazard_sets',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    hazardIds: jsonb('hazard_ids').$type<string[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('hazid_hazard_sets_tenant_idx').on(t.tenantId),
  }),
)

// ----------------------------------------------------------------------------
// Task library
// ----------------------------------------------------------------------------
export const hazidTasks = pgTable(
  'hazid_tasks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    // Default associated hazards (array of hazid_hazards.id) — copied onto a
    // hazid_assessment_tasks row when the task is added to an assessment.
    hazardIds: jsonb('hazard_ids').$type<string[]>().default([]).notNull(),
    controls: text('controls'), // default control text
    // Optional links to safe-work practice / safe-job procedure documents
    swpDocumentId: uuid('swp_document_id'),
    sjpDocumentId: uuid('sjp_document_id'),
    // Default risk rating for the task itself (legacy task-bank Severity /
    // Probability / RiskBefore / RiskAfter). 1-5 scales; risk score is derived
    // in app code as likelihood × severity.
    preLikelihood: integer('pre_likelihood'),
    preSeverity: integer('pre_severity'),
    postLikelihood: integer('post_likelihood'),
    postSeverity: integer('post_severity'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('hazid_tasks_tenant_idx').on(t.tenantId),
    nameIdx: index('hazid_tasks_name_idx').on(t.tenantId, t.name),
  }),
)

// ----------------------------------------------------------------------------
// Location-specific task suggestions
// ----------------------------------------------------------------------------
export const hazidLocationTasks = pgTable(
  'hazid_location_tasks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    orgUnitId: uuid('org_unit_id')
      .notNull()
      .references(() => orgUnits.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => hazidTasks.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('hazid_location_tasks_tenant_idx').on(t.tenantId),
    orgIdx: index('hazid_location_tasks_org_idx').on(t.orgUnitId),
    taskIdx: index('hazid_location_tasks_task_idx').on(t.taskId),
    orgTaskUx: uniqueIndex('hazid_location_tasks_org_task_ux').on(t.orgUnitId, t.taskId),
  }),
)

// ----------------------------------------------------------------------------
// Assessment types
// ----------------------------------------------------------------------------
// Style determines the assessment workflow:
//   - task_based: crews break the job into tasks, each with hazards and controls.
//   - hazard_based: crews describe the job scope and work through a default hazard set.
export const hazidAssessmentStyle = pgEnum('hazid_assessment_style', ['task_based', 'hazard_based'])

export const hazidAssessmentTypes = pgTable(
  'hazid_assessment_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    style: hazidAssessmentStyle('style').default('task_based').notNull(),

    // Optional sections. Tasks vs hazards are determined by `style` above.
    hasPPE: boolean('has_ppe').default(true).notNull(),
    hasQuestions: boolean('has_questions').default(true).notNull(),
    // Working-at-Heights, Confined Space, and Arc Flash are Builder Apps now,
    // not native sections — so there are no has_wah / has_cs / has_arc_flash
    // toggles on the type.

    // Optional default hazard set to seed the hazard list with.
    defaultHazardSetId: uuid('default_hazard_set_id').references(() => hazidHazardSets.id, {
      onDelete: 'set null',
    }),

    // Restrict which person-groups may start assessments of this type (legacy
    // AvailableTo). Empty array = available to everyone.
    availableToGroupIds: jsonb('available_to_group_ids').$type<string[]>().default([]).notNull(),

    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('hazid_assessment_types_tenant_idx').on(t.tenantId),
    tenantNameUx: uniqueIndex('hazid_assessment_types_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

// ----------------------------------------------------------------------------
// Type-default PPE rows
// ----------------------------------------------------------------------------
export const hazidAssessmentTypePPE = pgTable(
  'hazid_assessment_type_ppe',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => hazidAssessmentTypes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    required: boolean('required').default(true).notNull(),
    entityOrder: integer('entity_order').default(1).notNull(),
    ...timestamps,
  },
  (t) => ({
    typeIdx: index('hazid_assessment_type_ppe_type_idx').on(t.typeId, t.entityOrder),
    tenantIdx: index('hazid_assessment_type_ppe_tenant_idx').on(t.tenantId),
  }),
)

// ----------------------------------------------------------------------------
// Type-default Question rows
// ----------------------------------------------------------------------------
export const hazidQuestionType = pgEnum('hazid_question_type', ['yes_no', 'text', 'multi_select'])

export const hazidAssessmentTypeQuestions = pgTable(
  'hazid_assessment_type_questions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => hazidAssessmentTypes.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    questionType: hazidQuestionType('question_type').default('yes_no').notNull(),
    // For multi_select, the options shown to the user. Ignored for yes_no / text.
    answers: jsonb('answers').$type<string[]>().default([]).notNull(),
    requiresYes: boolean('requires_yes').default(false).notNull(),
    entityOrder: integer('entity_order').default(1).notNull(),
    ...timestamps,
  },
  (t) => ({
    typeIdx: index('hazid_assessment_type_questions_type_idx').on(t.typeId, t.entityOrder),
    tenantIdx: index('hazid_assessment_type_questions_tenant_idx').on(t.tenantId),
  }),
)

// ----------------------------------------------------------------------------
// Type-attached builder apps
// ----------------------------------------------------------------------------
// Assessment types can be composed out of the native JSHA sections above plus
// one or more form-builder apps. This is the abstraction layer for specialty
// structures such as confined-space entry plans, arc-flash studies, lift plans,
// or tenant-specific mini apps without hard-coding another sub-form column set.
export const hazidAssessmentTypeApps = pgTable(
  'hazid_assessment_type_apps',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    typeId: uuid('type_id')
      .notNull()
      .references(() => hazidAssessmentTypes.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => formTemplates.id, { onDelete: 'cascade' }),
    // Stable per-type key used by seeders/admin UI, e.g. "confined_space".
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    required: boolean('required').default(false).notNull(),
    autoCreate: boolean('auto_create').default(true).notNull(),
    entityOrder: integer('entity_order').default(1).notNull(),
    config: jsonb('config').$type<Record<string, unknown>>().default({}).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    typeIdx: index('hazid_assessment_type_apps_type_idx').on(t.typeId, t.entityOrder),
    templateIdx: index('hazid_assessment_type_apps_template_idx').on(t.templateId),
    tenantIdx: index('hazid_assessment_type_apps_tenant_idx').on(t.tenantId),
    typeKeyUx: uniqueIndex('hazid_assessment_type_apps_type_key_ux').on(t.typeId, t.key),
  }),
)

// ----------------------------------------------------------------------------
// Relations
// ----------------------------------------------------------------------------

export const hazidHazardTypesRelations = relations(hazidHazardTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [hazidHazardTypes.tenantId], references: [tenants.id] }),
  hazards: many(hazidHazards),
}))

export const hazidHazardsRelations = relations(hazidHazards, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidHazards.tenantId], references: [tenants.id] }),
  type: one(hazidHazardTypes, {
    fields: [hazidHazards.hazardTypeId],
    references: [hazidHazardTypes.id],
  }),
  photo: one(attachments, {
    fields: [hazidHazards.photoAttachmentId],
    references: [attachments.id],
  }),
}))

export const hazidHazardSetsRelations = relations(hazidHazardSets, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidHazardSets.tenantId], references: [tenants.id] }),
}))

export const hazidTasksRelations = relations(hazidTasks, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidTasks.tenantId], references: [tenants.id] }),
}))

export const hazidLocationTasksRelations = relations(hazidLocationTasks, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidLocationTasks.tenantId], references: [tenants.id] }),
  orgUnit: one(orgUnits, {
    fields: [hazidLocationTasks.orgUnitId],
    references: [orgUnits.id],
  }),
  task: one(hazidTasks, { fields: [hazidLocationTasks.taskId], references: [hazidTasks.id] }),
}))

export const hazidAssessmentTypesRelations = relations(hazidAssessmentTypes, ({ one, many }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentTypes.tenantId], references: [tenants.id] }),
  defaultHazardSet: one(hazidHazardSets, {
    fields: [hazidAssessmentTypes.defaultHazardSetId],
    references: [hazidHazardSets.id],
  }),
  ppe: many(hazidAssessmentTypePPE),
  questions: many(hazidAssessmentTypeQuestions),
  apps: many(hazidAssessmentTypeApps),
}))

export const hazidAssessmentTypePPERelations = relations(hazidAssessmentTypePPE, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentTypePPE.tenantId], references: [tenants.id] }),
  type: one(hazidAssessmentTypes, {
    fields: [hazidAssessmentTypePPE.typeId],
    references: [hazidAssessmentTypes.id],
  }),
}))

export const hazidAssessmentTypeQuestionsRelations = relations(
  hazidAssessmentTypeQuestions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [hazidAssessmentTypeQuestions.tenantId],
      references: [tenants.id],
    }),
    type: one(hazidAssessmentTypes, {
      fields: [hazidAssessmentTypeQuestions.typeId],
      references: [hazidAssessmentTypes.id],
    }),
  }),
)

export const hazidAssessmentTypeAppsRelations = relations(hazidAssessmentTypeApps, ({ one }) => ({
  tenant: one(tenants, { fields: [hazidAssessmentTypeApps.tenantId], references: [tenants.id] }),
  type: one(hazidAssessmentTypes, {
    fields: [hazidAssessmentTypeApps.typeId],
    references: [hazidAssessmentTypes.id],
  }),
  template: one(formTemplates, {
    fields: [hazidAssessmentTypeApps.templateId],
    references: [formTemplates.id],
  }),
}))
