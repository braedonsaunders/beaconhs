// Unified compliance engine schema.
//
// ONE obligation model for every module. The old per-module "assignment" tables
// (inspection_assignments, document_assignments, training_audience_assignments,
// form_assignments, journal_assignments) collapse into `compliance_obligations`
// + `compliance_audience`. Crucially this model does NOT care whether the thing
// being required is satisfied by a PERSON (per_person), a RECORD that mustn't
// expire (per_record), or a per-(person×task) sign-off (per_task) — so you can
// author "all Foremen hold a valid First Aid cert", "every Crane is inspected
// monthly", "issued PPE inspected every 90 days" in the same place as a journal
// cadence.
//
// Completion EVIDENCE stays in each module's own tables (training_records,
// inspection_records, equipment_items, …) and is read by per-module adapters.
// `compliance_status` is the materialized scoreboard (populated live today, by a
// worker scan later); `compliance_dispatches` is the recurring-fire ledger.

import { relations } from 'drizzle-orm'
import {
  date,
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
import { tenants, tenantUsers } from './core'
import { people } from './org'

export const complianceSourceModule = pgEnum('compliance_source_module', [
  'inspection',
  'document',
  'training', // course / assessment completion assignment
  'form', // scheduled App
  'journal',
  'cert_requirement', // audience must hold a valid certification (course)
  'equipment_inspection', // equipment of a type stays within its inspection cadence
  'ppe_inspection', // PPE of a type stays within its inspection/expiry cadence
  'job_title_signoff', // people with a title acknowledge a task
  'corrective_action',
  'permit',
  'lone_worker',
  'custom',
  // Frequency activity: people each produce/sign a hazard assessment on a cadence
  // (replaces the legacy "Hazard ID — Signatures" report).
  'hazard_assessment',
])

export const complianceSubjectKind = pgEnum('compliance_subject_kind', [
  'per_person', // audience expands to people; one status row per person per period
  'per_record', // one status row per underlying record (equipment item, permit, cert)
  'per_task', // one status row per (task × person)
])

export const complianceRecurrenceKind = pgEnum('compliance_recurrence_kind', [
  'one_time',
  'frequency',
  'cron',
  'expiry',
  'event',
])

export const complianceAudienceKind = pgEnum('compliance_audience_kind', [
  'everyone',
  'person',
  'role',
  'trade',
  'department',
  'org_unit',
])

export const complianceObligationStatus = pgEnum('compliance_obligation_status', [
  'active',
  'paused',
  'archived',
])

export const complianceStatusValue = pgEnum('compliance_status_value', [
  'pending',
  'in_progress',
  'completed',
  'overdue',
  'expiring',
  'waived',
  'not_applicable',
])

export const complianceDispatchStatus = pgEnum('compliance_dispatch_status', [
  'queued',
  'enqueued',
  'skipped',
  'failed',
])

// What is being required — discriminated by sourceModule. Only the relevant keys
// are set. (Validated in the action layer, not the DB.)
export type ComplianceTargetRef = {
  inspectionTypeId?: string
  documentId?: string
  courseId?: string
  assessmentTypeId?: string
  trainingItemKind?: 'course' | 'assessment_type'
  skillTypeId?: string // cert_requirement satisfied by a valid training_skill_assignment grant
  formTemplateId?: string
  equipmentTypeId?: string
  ppeTypeId?: string
  jobTitleId?: string
}

export type ComplianceRecurrence = {
  kind: 'one_time' | 'frequency' | 'cron' | 'expiry' | 'event'
  frequency?: 'day' | 'week' | 'month' | 'quarter' | 'year'
  quantity?: number
  cron?: string
  dueOn?: string // YYYY-MM-DD (one_time)
  dueOffsetDays?: number
  dueOffsetMinutes?: number
  remindBeforeDays?: number
  compliantPercentage?: number
  reminderBuckets?: number[]
}

export const complianceObligations = pgTable(
  'compliance_obligations',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    sourceModule: complianceSourceModule('source_module').notNull(),
    subjectKind: complianceSubjectKind('subject_kind').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    status: complianceObligationStatus('status').default('active').notNull(),
    targetRef: jsonb('target_ref').$type<ComplianceTargetRef>().default({}).notNull(),
    recurrence: jsonb('recurrence').$type<ComplianceRecurrence>().notNull(),
    // Denormalised recurrence.kind for cheap scanner filtering.
    recurrenceKind: complianceRecurrenceKind('recurrence_kind').notNull(),
    lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),
    // Stable identity of the authoring record or built-in rule that produced
    // this materialized obligation. This makes repeated scans idempotent.
    sourceKey: text('source_key'),
    sourceId: uuid('source_id'),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('compliance_obligations_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('compliance_obligations_tenant_id_id_ux').on(t.tenantId, t.id),
    createdByIdx: index('compliance_obligations_created_by_idx').on(
      t.tenantId,
      t.createdByTenantUserId,
    ),
    moduleIdx: index('compliance_obligations_module_idx').on(t.tenantId, t.sourceModule),
    scanIdx: index('compliance_obligations_scan_idx').on(t.recurrenceKind, t.status),
    sourceUx: uniqueIndex('compliance_obligations_source_ux').on(
      t.tenantId,
      t.sourceKey,
      t.sourceId,
    ),
    createdByFk: foreignKey({
      name: 'compliance_obligations_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const complianceAudience = pgTable(
  'compliance_audience',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    obligationId: uuid('obligation_id').notNull(),
    kind: complianceAudienceKind('kind').notNull(),
    // person→people.id, trade→trades.id, department→departments.id,
    // org_unit→org_units.id (uuid as text), role→roles.key, everyone→'' sentinel.
    entityKey: text('entity_key').default('').notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('compliance_audience_tenant_idx').on(t.tenantId),
    obligationIdx: index('compliance_audience_obligation_idx').on(t.tenantId, t.obligationId),
    uniqueUx: uniqueIndex('compliance_audience_unique_ux').on(
      t.tenantId,
      t.obligationId,
      t.kind,
      t.entityKey,
    ),
    obligationFk: foreignKey({
      name: 'compliance_audience_tenant_obligation_fk',
      columns: [t.tenantId, t.obligationId],
      foreignColumns: [complianceObligations.tenantId, complianceObligations.id],
    }).onDelete('cascade'),
  }),
)

export const complianceDispatches = pgTable(
  'compliance_dispatches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    obligationId: uuid('obligation_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    dueOn: date('due_on'),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    status: complianceDispatchStatus('status').default('queued').notNull(),
    audienceSnapshot: jsonb('audience_snapshot').$type<string[]>().default([]).notNull(),
    alertPayload: jsonb('alert_payload').$type<{
      transitions: Array<{
        subjectKey: string
        personId: string | null
        userId?: string | null
        label: string
        to: 'completed' | 'overdue' | 'pending' | 'in_progress' | 'expiring'
        dueOn: string | null
      }>
    } | null>(),
    error: text('error'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('compliance_dispatches_tenant_idx').on(t.tenantId),
    obligationIdx: index('compliance_dispatches_obligation_idx').on(
      t.tenantId,
      t.obligationId,
      t.occurredAt,
    ),
    obligationOccurrenceUx: uniqueIndex('compliance_dispatches_obligation_occurrence_ux').on(
      t.tenantId,
      t.obligationId,
      t.occurredAt,
    ),
    obligationFk: foreignKey({
      name: 'compliance_dispatches_tenant_obligation_fk',
      columns: [t.tenantId, t.obligationId],
      foreignColumns: [complianceObligations.tenantId, complianceObligations.id],
    }).onDelete('cascade'),
  }),
)

export const complianceStatus = pgTable(
  'compliance_status',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    obligationId: uuid('obligation_id').notNull(),
    // per_person / per_task set personId; per_record leaves it null.
    personId: uuid('person_id'),
    subjectRef: jsonb('subject_ref').$type<Record<string, string>>(),
    // Never-null dedupe key: person:<id>[|<periodStart>] / record:<id> / task:<taskId>:person:<id>
    subjectKey: text('subject_key').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end'),
    dueOn: date('due_on'),
    status: complianceStatusValue('status').default('pending').notNull(),
    completedOn: date('completed_on'),
    count: integer('count').default(0).notNull(),
    expected: integer('expected').default(0).notNull(),
    percent: integer('percent').default(0).notNull(),
    sourceRef: jsonb('source_ref').$type<Record<string, string>>(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('compliance_status_tenant_idx').on(t.tenantId),
    obligationIdx: index('compliance_status_obligation_idx').on(t.tenantId, t.obligationId),
    personIdx: index('compliance_status_person_idx').on(t.tenantId, t.personId),
    statusIdx: index('compliance_status_status_idx').on(t.tenantId, t.status),
    uniqueUx: uniqueIndex('compliance_status_unique_ux').on(
      t.tenantId,
      t.obligationId,
      t.subjectKey,
    ),
    obligationFk: foreignKey({
      name: 'compliance_status_tenant_obligation_fk',
      columns: [t.tenantId, t.obligationId],
      foreignColumns: [complianceObligations.tenantId, complianceObligations.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'compliance_status_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
  }),
)

export const complianceObligationsRelations = relations(complianceObligations, ({ many, one }) => ({
  tenant: one(tenants, { fields: [complianceObligations.tenantId], references: [tenants.id] }),
  audience: many(complianceAudience),
  status: many(complianceStatus),
  dispatches: many(complianceDispatches),
}))

export const complianceAudienceRelations = relations(complianceAudience, ({ one }) => ({
  obligation: one(complianceObligations, {
    fields: [complianceAudience.tenantId, complianceAudience.obligationId],
    references: [complianceObligations.tenantId, complianceObligations.id],
  }),
}))
