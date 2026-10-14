// AI Briefs: scheduled, AI-written analyses of tenant data (journals,
// incidents, corrective actions, inspections, …). A brief definition names its
// data sources and what to say; schedules decide when and to whom; every run
// keeps the exact evidence, the structured result, the model metadata, and a
// PDF so "why did it say that?" stays answerable. The JSON shapes are
// validated by @beaconhs/briefs before they are written.

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
import { id, timestamps } from './_helpers'
import { tenantUsers, tenants } from './core'
import { roles } from './iam'
import { reportCadence, reportRunDeliveryStatus } from './reports'

// --- JSON shapes ------------------------------------------------------------

export type BriefModelTier = 'fast' | 'smart'

export type BriefSourceConfig = {
  /** Registry key, e.g. 'journals.entries'. */
  key: string
  params: Record<string, unknown>
}

export type BriefSectionSpec = {
  key: string
  title: string
  guidance: string
  maxBullets: number
}

export type BriefSpec = {
  version: 1
  sources: BriefSourceConfig[]
  /** Audience, tone, and focus — tenant-editable guidance for the writer. */
  instructions: string
  sections: BriefSectionSpec[]
  targetWords: number
  tier: BriefModelTier
  /** What to do when the sources return nothing for the window. */
  emptyPolicy: 'send_notice' | 'skip'
  /** Give the writer the previous run so it can call out what changed. */
  compareWithPrevious: boolean
}

export type BriefWindowSpec =
  | { mode: 'previous_day' }
  | { mode: 'previous_business_day' }
  | { mode: 'last_n_days'; days: number }
  | { mode: 'since_last_run' }

export type BriefBullet = { text: string; citations: string[] }

export type BriefResult = {
  headline: string
  summary: string
  sections: Array<{ key: string; title: string; bullets: BriefBullet[] }>
  followUps: Array<{
    action: string
    owner: string | null
    priority: 'low' | 'medium' | 'high'
    citations: string[]
  }>
  /** What changed since the previous run, when the brief compares runs. */
  changes: string[]
  /** Set when AI analysis did not run (empty window, AI off, budget reached). */
  notice: string | null
}

export type BriefFact = {
  key: string
  label: string
  value: string
  items?: Array<{ label: string; value: string }>
}

export type BriefEvidenceRecord = {
  /** Citation key the writer uses, e.g. 'J12'. */
  ref: string
  source: string
  id: string
  /** In-app path to the record. */
  path: string
  date: string
  title: string
  author: string | null
  department: string | null
  site: string | null
  status: string | null
  excerpt: string
}

export type BriefEvidence = {
  window: { start: string; end: string; label: string; timezone: string }
  scope: { departmentId: string | null; departmentName: string | null }
  facts: BriefFact[]
  sources: Array<{ key: string; label: string; count: number; truncated: number }>
  records: BriefEvidenceRecord[]
  contentHash: string
}

export type BriefAiMeta = {
  provider: string | null
  model: string | null
  tier: BriefModelTier
  specVersion: number
  promptHash: string
  inputTokens: number
  outputTokens: number
  latencyMs: number
  passes: number
  droppedCitations: number
  uncitedBullets: number
  skippedReason: 'empty' | 'ai_unavailable' | 'budget_reached' | null
}

export type BriefRunDelivery = {
  userIds: string[]
  groupIds: string[]
  emails: string[]
  subject: string | null
}

// --- Enums ------------------------------------------------------------------

export const briefStatus = pgEnum('brief_status', ['active', 'archived'])
export const briefRunStatus = pgEnum('brief_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
])
export const briefRunTrigger = pgEnum('brief_run_trigger', [
  'scheduled',
  'manual',
  'preview',
  'api',
])
export const briefScheduleSplit = pgEnum('brief_schedule_split', ['none', 'department'])

// --- Definitions --------------------------------------------------------------

export const briefs = pgTable(
  'briefs',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** The built-in template this brief started from (informational). */
    templateKey: text('template_key'),
    name: text('name').notNull(),
    description: text('description'),
    spec: jsonb('spec').$type<BriefSpec>().notNull(),
    /** Bumped on every saved spec change; runs record the version they used. */
    specVersion: integer('spec_version').default(1).notNull(),
    status: briefStatus('status').default('active').notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    updatedByTenantUserId: uuid('updated_by_tenant_user_id'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('briefs_tenant_idx').on(t.tenantId, t.status),
    tenantIdIdUx: uniqueIndex('briefs_tenant_id_id_ux').on(t.tenantId, t.id),
    createdByIdx: index('briefs_created_by_idx').on(t.tenantId, t.createdByTenantUserId),
    updatedByIdx: index('briefs_updated_by_idx').on(t.tenantId, t.updatedByTenantUserId),
    nameNonblank: check('briefs_name_nonblank_ck', sql`length(btrim(${t.name})) > 0`),
    specVersionCheck: check('briefs_spec_version_ck', sql`${t.specVersion} >= 1`),
    createdByFk: foreignKey({
      name: 'briefs_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    updatedByFk: foreignKey({
      name: 'briefs_tenant_updated_by_fk',
      columns: [t.tenantId, t.updatedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

// --- Schedules ----------------------------------------------------------------

export const briefSchedules = pgTable(
  'brief_schedules',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    briefId: uuid('brief_id').notNull(),
    name: text('name').notNull(),
    cadence: reportCadence('cadence').notNull(),
    repeatEvery: integer('repeat_every').default(1).notNull(),
    dayOfWeek: integer('day_of_week'),
    dayOfMonth: integer('day_of_month'),
    weekOfMonth: integer('week_of_month'),
    hour: integer('hour').notNull(),
    minute: integer('minute').notNull(),
    timezone: text('timezone').default('America/Toronto').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    /** Daily cadence only: skip Saturday and Sunday occurrences. */
    weekdaysOnly: boolean('weekdays_only').default(false).notNull(),
    window: jsonb('window').$type<BriefWindowSpec>().notNull(),
    /** 'department' writes one brief per recipient department. */
    split: briefScheduleSplit('split').default('none').notNull(),
    recipientUserIds: jsonb('recipient_user_ids').$type<string[]>().default([]).notNull(),
    recipientGroupIds: jsonb('recipient_group_ids').$type<string[]>().default([]).notNull(),
    recipientEmails: jsonb('recipient_emails').$type<string[]>().default([]).notNull(),
    emailSubject: text('email_subject'),
    /** Sources run with this member's (and optionally role's) visibility. */
    runAsTenantUserId: uuid('run_as_tenant_user_id').notNull(),
    runAsRoleId: uuid('run_as_role_id'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    active: boolean('active').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('brief_schedules_tenant_idx').on(t.tenantId),
    dueIdx: index('brief_schedules_due_idx').on(t.active, t.nextRunAt),
    briefIdx: index('brief_schedules_brief_idx').on(t.tenantId, t.briefId),
    runAsTenantUserIdx: index('brief_schedules_run_as_tenant_user_idx').on(
      t.tenantId,
      t.runAsTenantUserId,
    ),
    runAsRoleIdx: index('brief_schedules_run_as_role_idx').on(t.tenantId, t.runAsRoleId),
    tenantIdIdUx: uniqueIndex('brief_schedules_tenant_id_id_ux').on(t.tenantId, t.id),
    repeatEveryCheck: check(
      'brief_schedules_repeat_every_ck',
      sql`${t.repeatEvery} between 1 and 999`,
    ),
    timeCheck: check(
      'brief_schedules_time_ck',
      sql`${t.hour} between 0 and 23 and ${t.minute} between 0 and 59`,
    ),
    dateBoundsCheck: check(
      'brief_schedules_date_bounds_ck',
      sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.startsOn} <= ${t.endsOn}`,
    ),
    briefFk: foreignKey({
      name: 'brief_schedules_tenant_brief_fk',
      columns: [t.tenantId, t.briefId],
      foreignColumns: [briefs.tenantId, briefs.id],
    }).onDelete('cascade'),
    runAsTenantUserFk: foreignKey({
      name: 'brief_schedules_tenant_run_as_user_fk',
      columns: [t.tenantId, t.runAsTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }).onDelete('restrict'),
    runAsRoleFk: foreignKey({
      name: 'brief_schedules_tenant_run_as_role_fk',
      columns: [t.tenantId, t.runAsRoleId],
      foreignColumns: [roles.tenantId, roles.id],
    }).onDelete('restrict'),
  }),
)

// --- Runs ---------------------------------------------------------------------

export const briefRuns = pgTable(
  'brief_runs',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    briefId: uuid('brief_id').notNull(),
    /** Null for manual, preview, and API runs, and once a schedule is deleted. */
    scheduleId: uuid('schedule_id'),
    /** Scheduled occurrence + split scope, unique per schedule. */
    occurrenceKey: text('occurrence_key'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    trigger: briefRunTrigger('trigger').notNull(),
    status: briefRunStatus('status').default('queued').notNull(),
    briefName: text('brief_name').notNull(),
    specVersion: integer('spec_version').notNull(),
    specSnapshot: jsonb('spec_snapshot').$type<BriefSpec>().notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    windowLabel: text('window_label').notNull(),
    timezone: text('timezone').notNull(),
    /** Department the run is limited to (split schedules), else null. */
    departmentId: uuid('department_id'),
    delivery: jsonb('delivery').$type<BriefRunDelivery | null>(),
    runAsTenantUserId: uuid('run_as_tenant_user_id'),
    runAsRoleId: uuid('run_as_role_id'),
    requestedByTenantUserId: uuid('requested_by_tenant_user_id'),
    requestedByApiKeyId: uuid('requested_by_api_key_id'),
    result: jsonb('result').$type<BriefResult | null>(),
    evidence: jsonb('evidence').$type<BriefEvidence | null>(),
    aiMeta: jsonb('ai_meta').$type<BriefAiMeta | null>(),
    error: text('error'),
    /** Tenant FK installed from ATTACHMENT_TENANT_REFERENCES (set null on delete). */
    pdfAttachmentId: uuid('pdf_attachment_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('brief_runs_tenant_idx').on(t.tenantId, t.createdAt),
    briefIdx: index('brief_runs_brief_idx').on(t.tenantId, t.briefId, t.createdAt),
    scheduleIdx: index('brief_runs_schedule_idx').on(t.tenantId, t.scheduleId),
    statusIdx: index('brief_runs_status_idx').on(t.status, t.createdAt),
    departmentIdx: index('brief_runs_department_idx').on(t.tenantId, t.departmentId),
    runAsIdx: index('brief_runs_run_as_idx').on(t.tenantId, t.runAsTenantUserId),
    requestedByIdx: index('brief_runs_requested_by_idx').on(t.tenantId, t.requestedByTenantUserId),
    pdfAttachmentIdx: index('brief_runs_pdf_attachment_idx').on(t.tenantId, t.pdfAttachmentId),
    occurrenceUx: uniqueIndex('brief_runs_schedule_occurrence_ux')
      .on(t.scheduleId, t.occurrenceKey)
      .where(sql`${t.scheduleId} is not null`),
    tenantIdIdUx: uniqueIndex('brief_runs_tenant_id_id_ux').on(t.tenantId, t.id),
    windowCheck: check('brief_runs_window_ck', sql`${t.windowStart} < ${t.windowEnd}`),
    scheduledCheck: check(
      'brief_runs_scheduled_ck',
      sql`${t.trigger} <> 'scheduled' or (${t.scheduledFor} is not null and ${t.occurrenceKey} is not null)`,
    ),
    briefFk: foreignKey({
      name: 'brief_runs_tenant_brief_fk',
      columns: [t.tenantId, t.briefId],
      foreignColumns: [briefs.tenantId, briefs.id],
    }).onDelete('cascade'),
    scheduleFk: foreignKey({
      name: 'brief_runs_tenant_schedule_fk',
      columns: [t.tenantId, t.scheduleId],
      foreignColumns: [briefSchedules.tenantId, briefSchedules.id],
    }),
    requestedByFk: foreignKey({
      name: 'brief_runs_tenant_requested_by_fk',
      columns: [t.tenantId, t.requestedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const briefRunDeliveries = pgTable(
  'brief_run_deliveries',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runId: uuid('run_id').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    status: reportRunDeliveryStatus('status').default('queued').notNull(),
    emailJobId: text('email_job_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    runRecipientUx: uniqueIndex('brief_run_deliveries_run_recipient_ux').on(
      t.runId,
      t.recipientEmail,
    ),
    tenantRunIdx: index('brief_run_deliveries_tenant_run_idx').on(t.tenantId, t.runId),
    statusIdx: index('brief_run_deliveries_status_idx').on(t.status),
    runFk: foreignKey({
      name: 'brief_run_deliveries_tenant_run_fk',
      columns: [t.tenantId, t.runId],
      foreignColumns: [briefRuns.tenantId, briefRuns.id],
    }).onDelete('cascade'),
  }),
)

// --- AI usage metering ----------------------------------------------------------

/**
 * One row per model call, written by the metering middleware every AI call site
 * shares. Feeds Admin → AI → Usage and the optional monthly token budget.
 */
export const aiUsageEvents = pgTable(
  'ai_usage_events',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    feature: text('feature').notNull(),
    tier: text('tier').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    latencyMs: integer('latency_ms').default(0).notNull(),
    outcome: text('outcome').$type<'succeeded' | 'failed'>().notNull(),
    error: text('error'),
    tenantUserId: uuid('tenant_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    tenantCreatedIdx: index('ai_usage_events_tenant_created_idx').on(t.tenantId, t.createdAt),
    tenantFeatureIdx: index('ai_usage_events_tenant_feature_idx').on(
      t.tenantId,
      t.feature,
      t.createdAt,
    ),
    tenantUserIdx: index('ai_usage_events_tenant_user_idx').on(t.tenantId, t.tenantUserId),
    outcomeCheck: check('ai_usage_events_outcome_ck', sql`${t.outcome} in ('succeeded', 'failed')`),
    tokensCheck: check(
      'ai_usage_events_tokens_ck',
      sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.latencyMs} >= 0`,
    ),
    tenantUserFk: foreignKey({
      name: 'ai_usage_events_tenant_user_fk',
      columns: [t.tenantId, t.tenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

// --- Relations ------------------------------------------------------------------

export const briefsRelations = relations(briefs, ({ one, many }) => ({
  tenant: one(tenants, { fields: [briefs.tenantId], references: [tenants.id] }),
  schedules: many(briefSchedules),
  runs: many(briefRuns),
}))

export const briefSchedulesRelations = relations(briefSchedules, ({ one }) => ({
  brief: one(briefs, {
    fields: [briefSchedules.tenantId, briefSchedules.briefId],
    references: [briefs.tenantId, briefs.id],
  }),
}))

export const briefRunsRelations = relations(briefRuns, ({ one, many }) => ({
  brief: one(briefs, {
    fields: [briefRuns.tenantId, briefRuns.briefId],
    references: [briefs.tenantId, briefs.id],
  }),
  schedule: one(briefSchedules, {
    fields: [briefRuns.tenantId, briefRuns.scheduleId],
    references: [briefSchedules.tenantId, briefSchedules.id],
  }),
  deliveries: many(briefRunDeliveries),
}))

export const briefRunDeliveriesRelations = relations(briefRunDeliveries, ({ one }) => ({
  run: one(briefRuns, {
    fields: [briefRunDeliveries.tenantId, briefRunDeliveries.runId],
    references: [briefRuns.tenantId, briefRuns.id],
  }),
}))
