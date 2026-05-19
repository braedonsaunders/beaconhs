// Per-job-title task list — the operational backbone of the Job Description
// PDF. Mirrors the legacy `PEOPLEJOBTITLETASKS` pivot but holds the task
// text directly (the legacy table referenced a HazID library); the platform
// keeps these self-contained so admins can phrase tasks specifically per
// title without polluting the HazID library.
//
// Each task supports a per-person acknowledgement record (signature data
// URL + timestamp + actor) — this lets supervisors audit which workers
// have signed off on their job description after a revision.

import { relations } from 'drizzle-orm'
import {
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'
import { people } from './org'
import { personTitles } from './people-titles'

export const jobTitleTasks = pgTable(
  'job_title_tasks',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    titleId: uuid('title_id')
      .notNull()
      .references(() => personTitles.id, { onDelete: 'cascade' }),
    task: text('task').notNull(),
    description: text('description'),
    entityOrder: doublePrecision('entity_order').default(0).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('job_title_tasks_tenant_idx').on(t.tenantId),
    titleIdx: index('job_title_tasks_title_idx').on(t.titleId),
    orderIdx: index('job_title_tasks_order_idx').on(t.titleId, t.entityOrder),
  }),
)

export const jobTitleTaskAcknowledgments = pgTable(
  'job_title_task_acknowledgments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => jobTitleTasks.id, { onDelete: 'cascade' }),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    signatureDataUrl: text('signature_data_url'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('job_title_task_acks_tenant_idx').on(t.tenantId),
    taskIdx: index('job_title_task_acks_task_idx').on(t.taskId),
    personIdx: index('job_title_task_acks_person_idx').on(t.personId),
    uniqueAck: uniqueIndex('job_title_task_acks_unique_ux').on(t.taskId, t.personId),
  }),
)

export const jobTitleTasksRelations = relations(jobTitleTasks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [jobTitleTasks.tenantId], references: [tenants.id] }),
  title: one(personTitles, {
    fields: [jobTitleTasks.titleId],
    references: [personTitles.id],
  }),
  acknowledgments: many(jobTitleTaskAcknowledgments),
}))

export const jobTitleTaskAcknowledgmentsRelations = relations(
  jobTitleTaskAcknowledgments,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [jobTitleTaskAcknowledgments.tenantId],
      references: [tenants.id],
    }),
    task: one(jobTitleTasks, {
      fields: [jobTitleTaskAcknowledgments.taskId],
      references: [jobTitleTasks.id],
    }),
    person: one(people, {
      fields: [jobTitleTaskAcknowledgments.personId],
      references: [people.id],
    }),
  }),
)
