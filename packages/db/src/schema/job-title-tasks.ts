// Per-job-title task list — the operational backbone of the Job Description
// PDF. Mirrors the legacy `PEOPLEJOBTITLETASKS` pivot but holds the task
// text directly (the legacy table referenced a HazID library); the platform
// keeps these self-contained so admins can phrase tasks specifically per
// title without polluting the HazID library.
//
// Each task supports a per-person acknowledgement record (private signature
// attachment + timestamp, with actor attribution in the audit log). This lets
// supervisors audit which workers signed off on their job description while
// keeping the acknowledged wording immutable.

import { relations } from 'drizzle-orm'
import {
  doublePrecision,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { attachments } from './attachments'
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
    titleId: uuid('title_id').notNull(),
    task: text('task').notNull(),
    description: text('description'),
    entityOrder: doublePrecision('entity_order').default(0).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('job_title_tasks_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('job_title_tasks_tenant_id_id_ux').on(t.tenantId, t.id),
    titleIdx: index('job_title_tasks_title_idx').on(t.tenantId, t.titleId),
    orderIdx: index('job_title_tasks_order_idx').on(t.tenantId, t.titleId, t.entityOrder),
    titleFk: foreignKey({
      name: 'job_title_tasks_tenant_title_fk',
      columns: [t.tenantId, t.titleId],
      foreignColumns: [personTitles.tenantId, personTitles.id],
    }).onDelete('cascade'),
  }),
)

export const jobTitleTaskAcknowledgments = pgTable(
  'job_title_task_acknowledgments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').notNull(),
    personId: uuid('person_id').notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).defaultNow().notNull(),
    signatureAttachmentId: uuid('signature_attachment_id'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('job_title_task_acks_tenant_idx').on(t.tenantId),
    taskIdx: index('job_title_task_acks_task_idx').on(t.tenantId, t.taskId),
    personIdx: index('job_title_task_acks_person_idx').on(t.tenantId, t.personId),
    uniqueAck: uniqueIndex('job_title_task_acks_unique_ux').on(t.tenantId, t.taskId, t.personId),
    taskFk: foreignKey({
      name: 'job_title_task_acks_tenant_task_fk',
      columns: [t.tenantId, t.taskId],
      foreignColumns: [jobTitleTasks.tenantId, jobTitleTasks.id],
    }).onDelete('cascade'),
    personFk: foreignKey({
      name: 'job_title_task_acks_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
    signatureAttachmentFk: foreignKey({
      name: 'job_title_task_acks_tenant_signature_attachment_fk',
      columns: [t.tenantId, t.signatureAttachmentId],
      foreignColumns: [attachments.tenantId, attachments.id],
    }),
  }),
)

export const jobTitleTasksRelations = relations(jobTitleTasks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [jobTitleTasks.tenantId], references: [tenants.id] }),
  title: one(personTitles, {
    fields: [jobTitleTasks.tenantId, jobTitleTasks.titleId],
    references: [personTitles.tenantId, personTitles.id],
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
      fields: [jobTitleTaskAcknowledgments.tenantId, jobTitleTaskAcknowledgments.taskId],
      references: [jobTitleTasks.tenantId, jobTitleTasks.id],
    }),
    person: one(people, {
      fields: [jobTitleTaskAcknowledgments.tenantId, jobTitleTaskAcknowledgments.personId],
      references: [people.tenantId, people.id],
    }),
    signatureAttachment: one(attachments, {
      fields: [
        jobTitleTaskAcknowledgments.tenantId,
        jobTitleTaskAcknowledgments.signatureAttachmentId,
      ],
      references: [attachments.tenantId, attachments.id],
    }),
  }),
)
