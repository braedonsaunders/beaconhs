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
  numeric,
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

export const formTemplateStatus = pgEnum('form_template_status', ['draft', 'published', 'archived'])

// What KIND of artifact this template is — reuses the same field builder but
// changes the builder panels + runtime shell. Additive; existing rows default
// to 'form' (today's behavior).
export const formTemplateKind = pgEnum('form_template_kind', [
  'form', // flat field set, single submit
  'wizard', // multi-step pages
  'checklist', // repeating items + scoring + auto-CAPA
  'register', // append-and-browse tabular log
  'mini_app', // composed surface (future free-form canvas)
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
    kind: formTemplateKind('kind').default('form').notNull(),
    iconKey: text('icon_key'),
    // App-level role gating. Empty / null ⇒ visible & usable by everyone (today's
    // behavior). Non-empty ⇒ only these role keys (plus admins / super-admins)
    // may see the app in the gallery and fill it out. Enforced in /forms + /fill.
    allowedRoles: jsonb('allowed_roles').$type<string[]>(),
    // Which built-in module this template powers, if any. Lets us hide certain
    // templates from the generic forms list when they're owned by a specialty UI.
    moduleBinding: text('module_binding'), // 'inspections' | 'jsha' | 'toolbox_talk' | 'incident_investigation' | …
    // When true, submitting a response auto-emails a recap to the configured
    // notification recipients (generic version of the old toolbox email recap).
    emailOnSubmit: boolean('email_on_submit').default(false).notNull(),
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

// The form schema is stored as JSONB. The TypeScript shape lives in
// @beaconhs/forms-core (source of truth + runtime validation); we re-export
// the relevant types here so consumers can import them from the same module
// they import Drizzle tables from.
export type {
  FormSchemaV1,
  I18nString,
  FormSection,
  FormField,
  FieldType,
  FieldValidation,
  LogicRule,
  FormulaExpression,
  DefaultValueExpression,
  FormWorkflowStep,
  AutomationGraph,
} from '@beaconhs/forms-core'

import type {
  AutomationGraph,
  FormSchemaV1,
  FormWorkflowStep,
  I18nString,
} from '@beaconhs/forms-core'

// FormWorkflow stays as a local alias: db schema talks about workflow as
// `{ steps: FormWorkflowStep[] }` and forms-core exports the shape inline on
// FormSchemaV1.workflow but not as a named type. Keep this here for callers.
export type FormWorkflow = {
  steps: FormWorkflowStep[]
}

// Per-step state inside a form_responses.workflow_state jsonb. Mirrors enough
// of form_response_steps for fast reads on the response detail page without
// joining. The form_response_steps table remains source-of-truth for indexing
// and per-step audit; this jsonb is a denormalised view written in lockstep.
export type FormResponseWorkflowStepState = {
  stepKey: string
  sequence: number
  status: 'pending' | 'signed' | 'rejected' | 'skipped'
  signedAt?: string // ISO 8601
  personId?: string | null
  tenantUserId?: string | null
  signatureDataUrl?: string | null
  rejectionReason?: string | null
  rejectedAt?: string // ISO 8601
  rejectedByTenantUserId?: string | null
  comment?: string | null
}

export type FormResponseWorkflowState = {
  steps: FormResponseWorkflowStepState[]
  lastActionAt?: string // ISO 8601
  lastActionByTenantUserId?: string | null
  lastAction?: 'sign' | 'advance' | 'reject' | 'reopen'
  lastReason?: string | null
}

// In-flight autosave payload written by the form filler while the user is
// still typing. Keyed shape mirrors the runtime state in form-renderer:
//   - `values` is the top-level field map (fieldId → value)
//   - `rows` is per-section row arrays (sectionId → Row[]) for repeating sections
// Persisted to form_responses.draft_data; cleared once status leaves 'draft'.
export type FormResponseDraftData = {
  values: Record<string, unknown>
  rows: Record<string, Array<Record<string, unknown>>>
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
  // Auto-flagged when a response fails its score routing rules
  // (threshold / hard-fail). Surfaced in the response viewer with a red
  // compliance pill + Failed-checks panel + Create-CAPA shortcut.
  'non_compliant',
])

// Higher-level status of the response's compliance verdict. Computed by the
// score-router helper at submit time and persisted on form_responses. Distinct
// from formResponseStatus (which tracks workflow position): a response can be
// `submitted` + `non_compliant` simultaneously.
export const formResponseComplianceStatus = pgEnum('form_response_compliance_status', [
  'compliant',
  'non_compliant',
  'pending_review',
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
    // In-flight draft state — written by the autosave path while the user is
    // still filling out the form. Distinct from `data` (which is set on the
    // canonical submit). Shape: { values, rows } where `values` is the
    // top-level field map and `rows` is per-repeating-section row arrays.
    // Cleared (or simply ignored) once status moves to anything other than
    // 'draft' / 'in_progress'.
    draftData: jsonb('draft_data').$type<FormResponseDraftData | null>(),
    draftUpdatedAt: timestamp('draft_updated_at', { withTimezone: true }),
    draftStepIndex: integer('draft_step_index'),
    // Optional link to source event (e.g. the incident that triggered this investigation form)
    sourceEntityType: text('source_entity_type'),
    sourceEntityId: uuid('source_entity_id'),
    // Compliance verdict written by the submit-side score-router helper. NULL
    // until a response has been scored (e.g. no scoring fields on the
    // template). complianceScore is 0–100; complianceStatus mirrors the
    // formResponseComplianceStatus enum.
    complianceScore: numeric('compliance_score', { precision: 6, scale: 2 }),
    complianceStatus: formResponseComplianceStatus('compliance_status'),
    // Generated PDF
    pdfAttachmentId: uuid('pdf_attachment_id'),
    // Workflow state machine — captures the *response-level* view of where the
    // multi-step workflow currently sits. Per-step detail lives in
    // form_response_steps rows; this column carries response-level metadata
    // (last action, last actor, last reason) plus a denormalised steps[] array
    // that the UI can read in a single fetch without joining.
    //
    // Shape (FormResponseWorkflowState):
    //   { steps: [{ stepKey, status, signedAt?, personId?, signatureDataUrl?,
    //               rejectionReason?, rejectedAt?, rejectedBy? }],
    //     lastActionAt?, lastActionByTenantUserId?, lastReason? }
    workflowState: jsonb('workflow_state').$type<FormResponseWorkflowState | null>().default(null),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('form_responses_tenant_idx').on(t.tenantId),
    templateIdx: index('form_responses_template_idx').on(t.tenantId, t.templateId),
    statusIdx: index('form_responses_status_idx').on(t.tenantId, t.status),
    siteIdx: index('form_responses_site_idx').on(t.tenantId, t.siteOrgUnitId),
    submittedIdx: index('form_responses_submitted_idx').on(t.tenantId, t.submittedAt),
    sourceIdx: index('form_responses_source_idx').on(
      t.tenantId,
      t.sourceEntityType,
      t.sourceEntityId,
    ),
  }),
)

// Each row is one workflow step instance for one response. Created lazily the
// first time we need state for that step (sign / advance / reject). Older code
// reads only `signedAt` / `comment`; the additional columns are additive.
//
// Status state machine (column `status`):
//   pending  → not yet acted on
//   signed   → assignee captured a signature (terminal-for-this-step success)
//   rejected → assignee bounced the step back; response moves to in_review
//              and `currentStep` is left pointing at this step so a re-sign
//              can re-attempt it
//   skipped  → reserved for future "skip non-required step" flow
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
    // Lifecycle status. Defaults to 'pending'; populated by the workflow
    // server actions in apps/web/src/app/(app)/forms/responses/[id]/_actions.ts.
    status: text('status').default('pending').notNull(),
    // Inline signature data URL (PNG). Stored alongside the attachment-id
    // pointer so PDFs can render the signature without a separate fetch.
    signatureDataUrl: text('signature_data_url'),
    // Whose person record the signer represents (if internal).
    signedByPersonId: uuid('signed_by_person_id').references(() => people.id),
    // Which tenant_users row did the click — used by audit + assignee resolution.
    signedByTenantUserId: uuid('signed_by_tenant_user_id').references(() => tenantUsers.id),
    rejectionReason: text('rejection_reason'),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    rejectedByTenantUserId: uuid('rejected_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
  },
  (t) => ({
    responseIdx: index('form_response_steps_response_idx').on(t.responseId, t.sequence),
    tenantIdx: index('form_response_steps_tenant_idx').on(t.tenantId),
    statusIdx: index('form_response_steps_status_idx').on(t.tenantId, t.status),
  }),
)

// Comments on a form response — used for back-and-forth between reviewer and
// submitter, follow-up notes, or correction history.
export const formResponseComments = pgTable(
  'form_response_comments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    responseId: uuid('response_id')
      .notNull()
      .references(() => formResponses.id, { onDelete: 'cascade' }),
    authorTenantUserId: uuid('author_tenant_user_id').references(() => tenantUsers.id),
    body: text('body').notNull(),
    ...timestamps,
  },
  (t) => ({
    responseIdx: index('form_response_comments_response_idx').on(t.responseId, t.createdAt),
    tenantIdx: index('form_response_comments_tenant_idx').on(t.tenantId),
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

// --- Flows (automation graphs) ---------------------------------------------

// One unified automation graph per template (system actions + human gates).
// Edited in place — intentionally NOT pinned to an immutable version snapshot,
// so a broken recipient/rule can be fixed without republishing the schema.
export const formAutomations = pgTable(
  'form_automations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id')
      .notNull()
      .references(() => formTemplates.id, { onDelete: 'cascade' }),
    name: text('name').default('Flow').notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    graph: jsonb('graph').$type<AutomationGraph>().notNull(),
    ...timestamps,
  },
  (t) => ({
    // Many flows per template (each independently enable/disable-able).
    templateIdx: index('form_automations_template_idx').on(t.templateId),
    tenantIdx: index('form_automations_tenant_idx').on(t.tenantId),
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
