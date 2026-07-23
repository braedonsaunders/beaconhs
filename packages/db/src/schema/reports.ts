// AppKit report persistence. Every definition is tenant-scoped and uses the
// same editable AppKit query/layout contract. `seed_key` records only where a
// tenant's initial copy came from; it never changes editability or execution.

import { relations, sql } from 'drizzle-orm'
import type { CustomReportDefinition, ReportCustomQuery, ReportLayout } from '@appkit/reports'
export type {
  ReportCustomQuery,
  ReportFilterOperator,
  ReportRule,
  ReportRuleGroup,
} from '@appkit/reports'
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
import { durablePublication, id, timestamps } from './_helpers'
import { attachments } from './attachments'
import { tenantUsers, tenants } from './core'
import { roles } from './iam'

// --- Definitions ---------------------------------------------------------

export const reportDefinitions = pgTable(
  'report_definitions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Stable seed identity. Missing seeds are inserted, never overwritten. */
    seedKey: text('seed_key'),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category').notNull(),
    query: jsonb('query').$type<ReportCustomQuery>().notNull(),
    layout: jsonb('layout').$type<ReportLayout>().notNull(),
    state: text('state').$type<CustomReportDefinition['state']>().default('published').notNull(),
    tags: jsonb('tags').$type<string[]>().default([]).notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantSlugUx: uniqueIndex('report_definitions_tenant_slug_ux').on(t.tenantId, t.slug),
    tenantSeedUx: uniqueIndex('report_definitions_tenant_seed_ux')
      .on(t.tenantId, t.seedKey)
      .where(sql`${t.seedKey} is not null`),
    tenantStateIdx: index('report_definitions_tenant_state_idx').on(t.tenantId, t.state),
    tenantIdIdUx: uniqueIndex('report_definitions_tenant_id_id_ux').on(t.tenantId, t.id),
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
    definitionId: uuid('definition_id').notNull(),
    name: text('name').notNull(),
    cadence: reportCadence('cadence').notNull(),
    // Repeat every N cadence periods, anchored to startsOn when present.
    repeatEvery: integer('repeat_every').default(1).notNull(),
    // For weekly: 0..6 (0=Sun). For monthly nth-weekday mode, also 0..6.
    dayOfWeek: integer('day_of_week'),
    // Monthly day-of-month mode: 1..31. Mutually exclusive with weekOfMonth.
    dayOfMonth: integer('day_of_month'),
    // Monthly nth-weekday mode: 1..4 = ordinal, 5 = last.
    weekOfMonth: integer('week_of_month'),
    hour: integer('hour').notNull(),
    minute: integer('minute').notNull(),
    timezone: text('timezone').default('America/Toronto').notNull(),
    // Optional local-date bounds. An ended schedule remains visible in history
    // but has no next occurrence.
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    // Recipients. Either explicit users (we resolve emails at send time) or
    // freeform email addresses.
    recipientUserIds: jsonb('recipient_user_ids').$type<string[]>().default([]).notNull(),
    recipientEmails: jsonb('recipient_emails').$type<string[]>().default([]).notNull(),
    // Optional schedule-time AppKit filters AND-ed with the saved definition.
    filters: jsonb('filters').$type<Record<string, unknown>>().default({}).notNull(),
    // Optional delivery copy. Null uses the standard generated subject/body.
    emailSubject: text('email_subject'),
    emailMessage: text('email_message'),
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
    repeatEveryCheck: check(
      'report_schedules_repeat_every_ck',
      sql`${t.repeatEvery} between 1 and 999`,
    ),
    weekOfMonthCheck: check(
      'report_schedules_week_of_month_ck',
      sql`${t.weekOfMonth} is null or ${t.weekOfMonth} between 1 and 5`,
    ),
    dateBoundsCheck: check(
      'report_schedules_date_bounds_ck',
      sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.startsOn} <= ${t.endsOn}`,
    ),
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
    tenantDefinitionFk: foreignKey({
      columns: [t.tenantId, t.definitionId],
      foreignColumns: [reportDefinitions.tenantId, reportDefinitions.id],
      name: 'report_schedules_tenant_definition_fk',
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
    query: ReportCustomQuery
    layout: ReportLayout
    state: CustomReportDefinition['state']
    tags: string[]
  }
  filters: Record<string, unknown>
  recipientUserIds: string[]
  recipientEmails: string[]
  emailSubject: string | null
  emailMessage: string | null
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
    ...durablePublication,
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('report_runs_tenant_idx').on(t.tenantId),
    scheduleIdx: index('report_runs_schedule_idx').on(t.scheduleId, t.startedAt),
    statusIdx: index('report_runs_status_idx').on(t.status),
    publishAvailableIdx: index('report_runs_publish_available_idx').on(
      t.status,
      t.publishAvailableAt,
    ),
    publishClaimedIdx: index('report_runs_publish_claimed_idx').on(t.status, t.publishClaimedAt),
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
    publishAttemptsCheck: check('report_runs_publish_attempts_ck', sql`${t.publishAttempts} >= 0`),
    publishLeaseStateCheck: check(
      'report_runs_publish_lease_state_ck',
      sql`(
        (${t.status} = 'queued' AND (
          (${t.publishLeaseId} IS NULL AND ${t.publishClaimedAt} IS NULL)
          OR
          (${t.publishLeaseId} IS NOT NULL AND ${t.publishClaimedAt} IS NOT NULL)
        ))
        OR
        (${t.status} <> 'queued' AND ${t.publishLeaseId} IS NULL AND ${t.publishClaimedAt} IS NULL)
      )`,
    ),
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
