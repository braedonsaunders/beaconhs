// Scheduled reports + dashboards.
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
//   report_dashboards   — saved dashboard layouts. `layout` is a typed jsonb
//                         array of widget descriptors (kpi tiles + lists).
//                         Per-tenant; one default dashboard ships unset and
//                         the built-in dashboard page renders the canonical
//                         layout when no rows exist.

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
import { id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenants } from './core'

// --- Definitions (built-in cross-tenant + tenant-scoped custom) -----------

export const reportDefinitionKind = pgEnum('report_definition_kind', ['built_in', 'custom'])

/** The set of entities a custom report can target. Kept narrow on purpose —
 *  each value maps to a query plan in `apps/worker/src/workers/reports.ts`. */
export const REPORT_CUSTOM_ENTITIES = [
  'incidents',
  'corrective_actions',
  'training_records',
  // Externally-issued skills/certs per person — backed by the join-baked
  // `report_skill_assignments` view (see packages/db/src/views.ts), so the
  // single-table executor gets person/authority/trade columns flat.
  'skill_assignments',
  'inspections',
  'documents',
  'equipment',
  'ppe',
  'lone_worker',
  'form_responses',
  'form_participants',
] as const
export type ReportCustomEntity = (typeof REPORT_CUSTOM_ENTITIES)[number]

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
  'contains',
  'between_days_ago',
] as const
export type ReportFilterOperator = (typeof REPORT_FILTER_OPERATORS)[number]

export type ReportCustomFilter = {
  column: string
  op: ReportFilterOperator
  value?: string | number | string[] | number[] | null
}

export type ReportCustomQuery = {
  entity: ReportCustomEntity
  columns: string[]
  filters?: ReportCustomFilter[]
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
    ...timestamps,
  },
  (t) => ({
    slugUx: uniqueIndex('report_definitions_slug_ux').on(t.slug),
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
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    active: boolean('active').default(true).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('report_schedules_tenant_idx').on(t.tenantId),
    activeIdx: index('report_schedules_active_idx').on(t.active, t.nextRunAt),
    definitionIdx: index('report_schedules_definition_idx').on(t.definitionId),
  }),
)

// --- Runs (execution log) -------------------------------------------------

export const reportRunStatus = pgEnum('report_run_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
])

export const reportRuns = pgTable(
  'report_runs',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => reportSchedules.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    status: reportRunStatus('status').default('queued').notNull(),
    error: text('error'),
    pdfAttachmentId: uuid('pdf_attachment_id').references(() => attachments.id, {
      onDelete: 'set null',
    }),
    rowCount: integer('row_count'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('report_runs_tenant_idx').on(t.tenantId),
    scheduleIdx: index('report_runs_schedule_idx').on(t.scheduleId, t.startedAt),
    statusIdx: index('report_runs_status_idx').on(t.status),
  }),
)

// --- Dashboards (per-tenant saved layouts) --------------------------------

/** Layout-payload widget kinds. Renderer maps each to a query helper. */
export const REPORT_DASHBOARD_WIDGET_KINDS = [
  'kpi_incidents_30d',
  'kpi_open_cas',
  'kpi_overdue_cas',
  'kpi_trir',
  'kpi_dart',
  'kpi_training_compliance',
  'kpi_document_compliance',
  'kpi_open_ca_aging',
  'kpi_inspections_this_month',
  'kpi_lw_active',
  'kpi_ppe_overdue',
  'kpi_certs_expiring_90d',
  'kpi_submissions_today',
  'kpi_cs_active',
  'kpi_people',
  'list_recent_incidents',
  'list_due_cas',
  'list_expiring_certs',
  'list_top_sites_incidents',
  'list_top_overdue_cas',
  'list_expiring_training_30d',
  'list_inbox',
] as const
export type ReportDashboardWidgetKind = (typeof REPORT_DASHBOARD_WIDGET_KINDS)[number]

export type ReportDashboardWidget = {
  id: string
  kind: ReportDashboardWidgetKind
  title?: string
  /** Reserved for future placement (grid coords). */
  position?: { col: number; row: number; w: number; h: number }
  options?: Record<string, unknown>
}

export type ReportDashboardLayout = {
  widgets: ReportDashboardWidget[]
}

export const reportDashboards = pgTable(
  'report_dashboards',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** True for the dashboard rendered on /dashboard when no id provided. */
    isDefault: boolean('is_default').default(false).notNull(),
    layout: jsonb('layout').$type<ReportDashboardLayout>().notNull(),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('report_dashboards_tenant_idx').on(t.tenantId),
    tenantNameUx: uniqueIndex('report_dashboards_tenant_name_ux').on(t.tenantId, t.name),
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

export const reportRunsRelations = relations(reportRuns, ({ one }) => ({
  tenant: one(tenants, { fields: [reportRuns.tenantId], references: [tenants.id] }),
  schedule: one(reportSchedules, {
    fields: [reportRuns.scheduleId],
    references: [reportSchedules.id],
  }),
  pdfAttachment: one(attachments, {
    fields: [reportRuns.pdfAttachmentId],
    references: [attachments.id],
  }),
}))

export const reportDashboardsRelations = relations(reportDashboards, ({ one }) => ({
  tenant: one(tenants, { fields: [reportDashboards.tenantId], references: [tenants.id] }),
}))
