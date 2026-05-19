// Scheduled reports.
//
//   report_definitions  — system-defined report templates (NOT per-tenant).
//                         Identifies a queryKind, name, description, category.
//   report_schedules    — per-tenant subscription. Owns cadence, recipients,
//                         filters, and the rolling nextRunAt.
//   report_runs         — execution log. One row per attempted run, points
//                         at the generated PDF attachment.

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

// --- Definitions (cross-tenant) -------------------------------------------

export const reportDefinitions = pgTable(
  'report_definitions',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    category: text('category'), // 'incidents' | 'training' | 'corrective_actions' | 'inspections' | 'documents'
    // queryKind dispatches to a query helper in the worker. Keep as text so
    // plugins can register their own kinds without a schema change.
    queryKind: text('query_kind').notNull(),
    ...timestamps,
  },
  (t) => ({
    slugUx: uniqueIndex('report_definitions_slug_ux').on(t.slug),
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

// --- Relations ------------------------------------------------------------

export const reportDefinitionsRelations = relations(reportDefinitions, ({ many }) => ({
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
