// Form builder schema. This is the centerpiece of the platform.
//
// Lifecycle:
//   form_templates (stable identity)
//     └─ form_template_versions (immutable schema snapshots)
//          └─ form_responses (filled submissions, pinned to a version)
//               └─ form_response_steps (multi-step workflow audit)
//
// form_assignments distribute a template (on-demand / scheduled / triggered / manual)

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
import { tenants, tenantUsers, users } from './core'
import { orgUnits, people } from './org'

export const formTemplateStatus = pgEnum('form_template_status', [
  'draft',
  'published',
  'archived',
])

export const formTemplates = pgTable(
  'form_templates',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // stable slug across versions
    name: text('name').notNull(),
    category: text('category'), // e.g. 'inspection', 'jsha', 'toolbox_talk', 'custom'
    description: text('description'),
    status: formTemplateStatus('status').default('draft').notNull(),
    iconKey: text('icon_key'),
    // Which built-in module this template powers, if any. Lets us hide certain
    // templates from the generic forms list when they're owned by a specialty UI.
    moduleBinding: text('module_binding'), // 'inspections' | 'jsha' | 'toolbox_talk' | 'incident_investigation' | …
    createdBy: text('created_by').references(() => users.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantKeyUx: uniqueIndex('form_templates_tenant_key_ux').on(t.tenantId, t.key),
    tenantIdx: index('form_templates_tenant_idx').on(t.tenantId),
    categoryIdx: index('form_templates_category_idx').on(t.tenantId, t.category),
  }),
)

// Versions are immutable once published. Drafts can be edited.
export const formTemplateVersions = pgTable(
  'form_template_versions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => formTemplates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    schema: jsonb('schema').$type<FormSchemaV1>().notNull(),
    changelog: text('changelog'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: text('published_by').references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    templateVersionUx: uniqueIndex('form_template_versions_uniq').on(t.templateId, t.version),
    tenantIdx: index('form_template_versions_tenant_idx').on(t.tenantId),
  }),
)

// The form schema is stored as JSONB. The TypeScript shape is the source of truth;
// runtime validation lives in @beaconhs/forms-core.
export type FormSchemaV1 = {
  schemaVersion: 1
  title: I18nString
  description?: I18nString
  sections: FormSection[]
  workflow: FormWorkflow
  permissions?: { fieldVisibility?: Record<string, string[]> }
  pdf?: { css?: string; header?: string; footer?: string; pageSize?: 'A4' | 'Letter' }
  metadata?: { riskMatrixKey?: string }
}

export type I18nString = Record<string, string> // { en: '…', fr: '…' }

export type FormSection = {
  id: string
  title?: I18nString
  description?: I18nString
  showIf?: LogicRule
  repeating?: boolean
  step?: string // bind this section to a workflow step
  fields: FormField[]
}

export type FormField = {
  id: string
  type: FieldType
  label: I18nString
  helpText?: I18nString
  required?: boolean
  showIf?: LogicRule
  validation?: FieldValidation
  permissions?: { visibleToRoles?: string[] }
  config?: Record<string, unknown> // type-specific
}

export type FieldType =
  // Standard inputs
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'time'
  | 'email'
  | 'phone'
  | 'url'
  // Choice
  | 'radio'
  | 'checkbox_group'
  | 'select'
  | 'multi_select'
  // Compliance scoring
  | 'pass_fail_na'
  | 'rating'
  | 'yes_no_comment'
  | 'traffic_light'
  // Domain pickers
  | 'person_picker'
  | 'site_picker'
  | 'equipment_picker'
  | 'ppe_picker'
  | 'document_picker'
  | 'course_picker'
  // Media
  | 'photo'
  | 'file'
  | 'video'
  | 'audio'
  // Identity
  | 'signature'
  | 'typed_attestation'
  // Computed
  | 'formula'
  | 'risk_matrix'
  // Display
  | 'heading'
  | 'paragraph'
  | 'image'
  | 'divider'

export type FieldValidation = {
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  options?: { value: string; label: I18nString }[]
  allowOther?: boolean
}

export type LogicRule =
  | { op: 'and' | 'or'; rules: LogicRule[] }
  | { op: 'not'; rule: LogicRule }
  | { op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte'; field: string; value: unknown }
  | { op: 'in' | 'notIn'; field: string; value: unknown[] }
  | { op: 'isSet' | 'isNotSet'; field: string }

export type FormWorkflow = {
  steps: FormWorkflowStep[]
}

export type FormWorkflowStep = {
  key: string
  title: I18nString
  assignee:
    | { type: 'literal'; userId: string }
    | { type: 'role'; role: string }
    | { type: 'expression'; expr: string } // e.g. '$foreman_of_site', '$submitter'
  signatureRequired?: boolean
  visibleSections?: string[]
  visibleFields?: string[]
}

// --- Assignments -----------------------------------------------------------

export const formAssignmentMode = pgEnum('form_assignment_mode', [
  'on_demand',
  'scheduled',
  'event_triggered',
  'manual',
])

export const formAssignments = pgTable(
  'form_assignments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => formTemplates.id, { onDelete: 'cascade' }),
    mode: formAssignmentMode('mode').notNull(),
    // Targeting (any subset can apply)
    targetRoleKeys: jsonb('target_role_keys').$type<string[] | null>(),
    targetOrgUnitIds: jsonb('target_org_unit_ids').$type<string[] | null>(),
    targetPersonIds: jsonb('target_person_ids').$type<string[] | null>(),
    // Schedule (mode = scheduled)
    cron: text('cron'), // e.g. '0 8 * * 1' for Mon 8am
    dueOffsetMinutes: integer('due_offset_minutes'), // due relative to scheduled fire
    // Trigger (mode = event_triggered)
    triggerEvent: text('trigger_event'), // e.g. 'incident.created'
    triggerFilter: jsonb('trigger_filter').$type<Record<string, unknown> | null>(),
    // Manual one-shot due date
    dueAt: timestamp('due_at', { withTimezone: true }),
    enabled: boolean('enabled').default(true).notNull(),
    createdBy: text('created_by').references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('form_assignments_tenant_idx').on(t.tenantId),
    templateIdx: index('form_assignments_template_idx').on(t.templateId),
    modeIdx: index('form_assignments_mode_idx').on(t.tenantId, t.mode),
  }),
)

// --- Responses -------------------------------------------------------------

export const formResponseStatus = pgEnum('form_response_status', [
  'draft',
  'in_progress',
  'submitted',
  'in_review',
  'closed',
  'rejected',
])

export const formResponses = pgTable(
  'form_responses',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => formTemplates.id),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => formTemplateVersions.id),
    assignmentId: uuid('assignment_id').references(() => formAssignments.id),
    status: formResponseStatus('status').default('draft').notNull(),
    currentStep: text('current_step'),
    // Hot indexed columns for filtering
    siteOrgUnitId: uuid('site_org_unit_id').references(() => orgUnits.id),
    subjectPersonId: uuid('subject_person_id').references(() => people.id), // for forms about a specific person
    submittedBy: uuid('submitted_by').references(() => tenantUsers.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    // The actual response payload (keyed by field id)
    data: jsonb('data').$type<Record<string, unknown>>().default({}).notNull(),
    // Optional link to source event (e.g. the incident that triggered this investigation form)
    sourceEntityType: text('source_entity_type'),
    sourceEntityId: uuid('source_entity_id'),
    // Generated PDF
    pdfAttachmentId: uuid('pdf_attachment_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('form_responses_tenant_idx').on(t.tenantId),
    templateIdx: index('form_responses_template_idx').on(t.tenantId, t.templateId),
    statusIdx: index('form_responses_status_idx').on(t.tenantId, t.status),
    siteIdx: index('form_responses_site_idx').on(t.tenantId, t.siteOrgUnitId),
    submittedIdx: index('form_responses_submitted_idx').on(t.tenantId, t.submittedAt),
    sourceIdx: index('form_responses_source_idx').on(t.tenantId, t.sourceEntityType, t.sourceEntityId),
  }),
)

export const formResponseSteps = pgTable(
  'form_response_steps',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    responseId: uuid('response_id')
      .notNull()
      .references(() => formResponses.id, { onDelete: 'cascade' }),
    stepKey: text('step_key').notNull(),
    sequence: integer('sequence').notNull(),
    assigneeTenantUserId: uuid('assignee_tenant_user_id').references(() => tenantUsers.id),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    signatureAttachmentId: uuid('signature_attachment_id'),
    comment: text('comment'),
    ...timestamps,
  },
  (t) => ({
    responseIdx: index('form_response_steps_response_idx').on(t.responseId, t.sequence),
    tenantIdx: index('form_response_steps_tenant_idx').on(t.tenantId),
  }),
)

// Extracted compliance scores per response, for analytic roll-ups.
// One row per scored field per response.
export const formResponseScores = pgTable(
  'form_response_scores',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    responseId: uuid('response_id')
      .notNull()
      .references(() => formResponses.id, { onDelete: 'cascade' }),
    fieldId: text('field_id').notNull(),
    sectionId: text('section_id'),
    score: integer('score'), // 1=pass, 0=fail, null=n/a, or 1..5 for rating
    label: text('label'), // 'pass'|'fail'|'na'|'rating:3'|…
    weight: integer('weight').default(1).notNull(),
  },
  (t) => ({
    responseIdx: index('form_response_scores_response_idx').on(t.responseId),
    tenantIdx: index('form_response_scores_tenant_idx').on(t.tenantId),
  }),
)

// --- Relations -------------------------------------------------------------

export const formTemplatesRelations = relations(formTemplates, ({ one, many }) => ({
  tenant: one(tenants, { fields: [formTemplates.tenantId], references: [tenants.id] }),
  versions: many(formTemplateVersions),
  assignments: many(formAssignments),
  responses: many(formResponses),
}))

export const formTemplateVersionsRelations = relations(formTemplateVersions, ({ one }) => ({
  template: one(formTemplates, {
    fields: [formTemplateVersions.templateId],
    references: [formTemplates.id],
  }),
}))

export const formResponsesRelations = relations(formResponses, ({ one, many }) => ({
  tenant: one(tenants, { fields: [formResponses.tenantId], references: [tenants.id] }),
  template: one(formTemplates, {
    fields: [formResponses.templateId],
    references: [formTemplates.id],
  }),
  version: one(formTemplateVersions, {
    fields: [formResponses.templateVersionId],
    references: [formTemplateVersions.id],
  }),
  steps: many(formResponseSteps),
  scores: many(formResponseScores),
}))
