// Document reports (HTML view + scheduled PDF email). Dashboards are NOT a
// reports concept — live dashboards/grids live in the Insights module
// (insight_dashboards in insights.ts).
//
//   report_definitions  — report templates.
//                         `kind='built_in'`  → system-defined, tenantId is null,
//                                              dispatched via queryKind.
//                         `kind='custom'`    → tenant-defined, tenantId is set,
//                                              custom_query jsonb describes the
//                                              entity / columns / filters /
//                                              group-by chosen in the builder.
//   report_schedules    — per-tenant subscription. Owns cadence, recipients,
//                         filters, and the rolling nextRunAt.
//   report_runs         — execution log. One row per attempted run, points
//                         at the generated PDF attachment.

import { relations, sql } from 'drizzle-orm'
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
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenantUsers, tenants } from './core'
import { roles } from './iam'

// --- Definitions (built-in cross-tenant + tenant-scoped custom) -----------

export const reportDefinitionKind = pgEnum('report_definition_kind', ['built_in', 'custom'])

/** Operators a custom-report filter clause can use. */
export const REPORT_FILTER_OPERATORS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'gte',
  'lte',
  'is_null',
  'is_not_null',
  // Boolean column tests (no value) — booleans surface as enum-kind columns.
  'is_true',
  'is_false',
  'contains',
  'between_days_ago',
  // Forward window: col on/before now + N days (includes overdue) — drives
  // "expiring soon / upcoming inspection" reports.
  'due_within_days',
  // Relative-date operators (no value) — anchored to the server clock at compile
  // time, so "this month" / "overdue" cards stay correct without a parameter.
  'since_today',
  'this_week',
  'this_month',
  'this_year',
  'before_now',
] as const
export type ReportFilterOperator = (typeof REPORT_FILTER_OPERATORS)[number]

/** Leaf clause in the nested filter tree. */
export type ReportRule = {
  field: string
  op: ReportFilterOperator
  value?: string | number | string[] | number[] | null
}

/** Nested and/or filter tree produced by the report studio and compiled to SQL
 *  by @beaconhs/reports. */
export type ReportRuleGroup = {
  combinator: 'and' | 'or'
  not?: boolean
  rules: (ReportRule | ReportRuleGroup)[]
}

/** Paper sizes a report document can print on. */
export const REPORT_PAPER_SIZES = ['letter', 'a4', 'legal'] as const
export type ReportPaperSize = (typeof REPORT_PAPER_SIZES)[number]

/** Document densities: compact shrinks type and cell padding so more rows fit
 *  per page. */
export const REPORT_DENSITIES = ['standard', 'compact'] as const
export type ReportDensity = (typeof REPORT_DENSITIES)[number]

/** Per-definition page setup for the printed document — drives the in-app
 *  paginated preview AND the PDF renderer (they share one template). A null
 *  layout means the default: landscape Letter, 15 mm margins, standard
 *  density, summary band shown. */
export type ReportLayoutConfig = {
  paperSize: ReportPaperSize
  orientation: 'portrait' | 'landscape'
  /** Uniform page margin in millimetres. */
  marginMm: number
  /** Print the key-figures summary band under the header. Default true. */
  showSummary?: boolean
  /** Type/padding scale for the whole document. Default 'standard'. */
  density?: ReportDensity
}

/** Aggregate functions a Summarize-mode measure can use. */
export const REPORT_AGG_FNS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max'] as const
export type ReportAggFn = (typeof REPORT_AGG_FNS)[number]

/** Temporal buckets for a Summarize-mode breakout on a date/timestamp column. */
export const REPORT_TEMPORAL_BINS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type ReportTemporalBin = (typeof REPORT_TEMPORAL_BINS)[number]

/** A group-by dimension in Summarize mode. A date/timestamp column can be
 *  bucketed by `bin` (e.g. month) before grouping. */
export type ReportBreakout = {
  column: string
  bin?: ReportTemporalBin
}

/** An aggregate column in Summarize mode. `column` is omitted only for `count`. */
export type ReportMeasure = {
  fn: ReportAggFn
  column?: string
  /** Optional display label; defaults to a humanised "<fn> of <column>". */
  label?: string
}

export type ReportCustomQuery = {
  /** Entity key — validated at runtime against the caller's permission-filtered
   *  discovered catalog. */
  entity: string
  /** 'rows' (default) = detail rows; 'summarize' = GROUP BY breakouts + measures. */
  mode?: 'rows' | 'summarize'
  columns: string[]
  /** Summarize mode: group-by dimensions (with optional temporal bucketing). */
  breakouts?: ReportBreakout[]
  /** Summarize mode: aggregate columns. */
  measures?: ReportMeasure[]
  /** Canonical nested and/or filter tree. */
  filters?: ReportRuleGroup | null
  groupBy?: string | null
  /** Defaults to descending by primary date column. */
  sort?: { column: string; direction: 'asc' | 'desc' } | null
  /** Hard cap on rows; renderer adds "showing N of M" footer. */
  limit?: number | null
}

export const reportDefinitions = pgTable(
  'report_definitions',
  {
    id: id(),
    /** Null for built-ins, set for tenant-scoped custom definitions. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    kind: reportDefinitionKind('kind').default('built_in').notNull(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'), // 'incidents' | 'training' | 'corrective_actions' | 'inspections' | 'documents' | 'equipment' | 'ppe' | 'lone_worker' | 'toolbox' | 'cross_module'
    // queryKind dispatches to a query helper in the worker. For 'custom' the
    // value is always 'custom_query' and the actual plan lives in customQuery.
    queryKind: text('query_kind').notNull(),
    /** Populated when kind='custom'. JSON-encoded ReportCustomQuery. */
    customQuery: jsonb('custom_query').$type<ReportCustomQuery | null>(),
    /** Page setup for the printed document; null = landscape Letter default. */
    layout: jsonb('layout').$type<ReportLayoutConfig | null>(),
    ...timestamps,
  },
  (t) => ({
    builtInSlugUx: uniqueIndex('report_definitions_builtin_slug_ux')
      .on(t.slug)
      .where(sql`${t.tenantId} is null`),
    tenantSlugUx: uniqueIndex('report_definitions_tenant_slug_ux')
      .on(t.tenantId, t.slug)
      .where(sql`${t.tenantId} is not null`),
    tenantKindIdx: index('report_definitions_tenant_kind_idx').on(t.tenantId, t.kind),
  }),
)

// --- Schedules (per-tenant subscriptions) ---------------------------------

export const reportCadence = pgEnum('report_cadence', ['daily', 'weekly', 'monthly'])

export const reportSchedules = pgTable(
  'report_schedules',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    definitionId: uuid('definition_id')
      .notNull()
      .references(() => reportDefinitions.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    cadence: reportCadence('cadence').notNull(),
    // For weekly: 0..6 (0=Sun). For monthly: 1..31. Null otherwise.
    dayOfWeek: integer('day_of_week'),
    dayOfMonth: integer('day_of_month'),
    hour: integer('hour').notNull(),
    minute: integer('minute').notNull(),
    timezone: text('timezone').default('America/Toronto').notNull(),
    // Recipients. Either explicit users (we resolve emails at send time) or
    // freeform email addresses.
    recipientUserIds: jsonb('recipient_user_ids').$type<string[]>().default([]).notNull(),
    recipientEmails: jsonb('recipient_emails').$type<string[]>().default([]).notNull(),
    // Filter payload — shape depends on the report's queryKind.
    filters: jsonb('filters').$type<Record<string, unknown>>().default({}).notNull(),
    // Scheduled custom reports are re-authorized at execution time as this
    // active tenant member and, when set, their currently assigned role.
    // A null role preserves the explicit union-of-current-assignments mode.
    runAsTenantUserId: uuid('run_as_tenant_user_id').notNull(),
    runAsRoleId: uuid('run_as_role_id'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    active: boolean('active').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('report_schedules_tenant_idx').on(t.tenantId),
    activeIdx: index('report_schedules_active_idx').on(t.active, t.nextRunAt),
    definitionIdx: index('report_schedules_definition_idx').on(t.definitionId),
    runAsTenantUserIdx: index('report_schedules_run_as_tenant_user_idx').on(t.runAsTenantUserId),
    runAsRoleIdx: index('report_schedules_run_as_role_idx').on(t.runAsRoleId),
    tenantIdIdUx: uniqueIndex('report_schedules_tenant_id_id_ux').on(t.tenantId, t.id),
    runAsTenantUserFk: foreignKey({
      columns: [t.tenantId, t.runAsTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
      name: 'report_schedules_tenant_run_as_user_fk',
    }).onDelete('restrict'),
    runAsRoleFk: foreignKey({
      columns: [t.tenantId, t.runAsRoleId],
      foreignColumns: [roles.tenantId, roles.id],
      name: 'report_schedules_tenant_run_as_role_fk',
    }).onDelete('restrict'),
  }),
)

// --- Runs (execution log) -------------------------------------------------

export const reportRunStatus = pgEnum('report_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
])
export const reportRunTrigger = pgEnum('report_run_trigger', ['scheduled', 'manual'])

export type ReportRunRequestSnapshot = {
  scheduleName: string
  definition: {
    id: string
    slug: string
    name: string
    queryKind: string
    customQuery: ReportCustomQuery | null
    layout: ReportLayoutConfig | null
  }
  filters: Record<string, unknown>
  recipientUserIds: string[]
  recipientEmails: string[]
  runAsTenantUserId: string
  runAsRoleId: string | null
}

export const reportRuns = pgTable(
  'report_runs',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    trigger: reportRunTrigger('trigger').notNull(),
    requestSnapshot: jsonb('request_snapshot').$type<ReportRunRequestSnapshot>().notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: reportRunStatus('status').default('queued').notNull(),
    error: text('error'),
    pdfAttachmentId: uuid('pdf_attachment_id'),
    rowCount: integer('row_count'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('report_runs_tenant_idx').on(t.tenantId),
    scheduleIdx: index('report_runs_schedule_idx').on(t.scheduleId, t.startedAt),
    statusIdx: index('report_runs_status_idx').on(t.status),
    scheduleOccurrenceUx: uniqueIndex('report_runs_schedule_occurrence_ux').on(
      t.scheduleId,
      t.scheduledFor,
    ),
    tenantIdIdUx: uniqueIndex('report_runs_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantScheduleFk: foreignKey({
      columns: [t.tenantId, t.scheduleId],
      foreignColumns: [reportSchedules.tenantId, reportSchedules.id],
      name: 'report_runs_tenant_schedule_fk',
    }).onDelete('cascade'),
  }),
)

export const reportRunDeliveryStatus = pgEnum('report_run_delivery_status', [
  'queued',
  'enqueued',
  'sent',
  'failed',
])

export const reportRunDeliveries = pgTable(
  'report_run_deliveries',
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
    runRecipientUx: uniqueIndex('report_run_deliveries_run_recipient_ux').on(
      t.runId,
      t.recipientEmail,
    ),
    tenantIdx: index('report_run_deliveries_tenant_idx').on(t.tenantId),
    statusIdx: index('report_run_deliveries_status_idx').on(t.status),
    tenantRunFk: foreignKey({
      columns: [t.tenantId, t.runId],
      foreignColumns: [reportRuns.tenantId, reportRuns.id],
      name: 'report_run_deliveries_tenant_run_fk',
    }).onDelete('cascade'),
  }),
)

// --- Relations ------------------------------------------------------------

export const reportDefinitionsRelations = relations(reportDefinitions, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportDefinitions.tenantId], references: [tenants.id] }),
  schedules: many(reportSchedules),
}))

export const reportSchedulesRelations = relations(reportSchedules, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportSchedules.tenantId], references: [tenants.id] }),
  definition: one(reportDefinitions, {
    fields: [reportSchedules.definitionId],
    references: [reportDefinitions.id],
  }),
  runs: many(reportRuns),
}))

export const reportRunsRelations = relations(reportRuns, ({ one, many }) => ({
  tenant: one(tenants, { fields: [reportRuns.tenantId], references: [tenants.id] }),
  schedule: one(reportSchedules, {
    fields: [reportRuns.scheduleId],
    references: [reportSchedules.id],
  }),
  pdfAttachment: one(attachments, {
    fields: [reportRuns.pdfAttachmentId],
    references: [attachments.id],
  }),
  deliveries: many(reportRunDeliveries),
}))

export const reportRunDeliveriesRelations = relations(reportRunDeliveries, ({ one }) => ({
  tenant: one(tenants, { fields: [reportRunDeliveries.tenantId], references: [tenants.id] }),
  run: one(reportRuns, {
    fields: [reportRunDeliveries.runId],
    references: [reportRuns.id],
  }),
}))
