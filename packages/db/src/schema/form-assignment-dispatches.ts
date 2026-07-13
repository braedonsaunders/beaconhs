// Dispatch ledger for scheduled form_assignments.
//
// The form-assignment scanner walks form_assignments where mode='scheduled' and
// the assignment cron is due. For each due assignment it inserts one row here
// per fire, then fans out notifications to the assignees. The scanner uses the
// max(occurredAt) for an assignment to decide whether it's already fired in the
// current minute window — keeps the scanner idempotent without adding a column
// on form_assignments itself.

import { relations } from 'drizzle-orm'
import {
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { formAssignments } from './forms'

export const formAssignmentDispatches = pgTable(
  'form_assignment_dispatches',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assignmentId: uuid('assignment_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    // 'queued' | 'enqueued' | 'skipped' | 'failed'
    status: text('status').notNull().default('queued'),
    // Audience snapshot — user ids notified at fire time (for audit)
    audienceUserIds: jsonb('audience_user_ids').$type<string[]>().default([]).notNull(),
    notificationPayload: jsonb('notification_payload').$type<{
      title: string
      body?: string
      linkPath: string
      data: { assignmentId: string; templateId: string }
    } | null>(),
    notificationJobId: text('notification_job_id'),
    error: text('error'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('form_assignment_dispatches_tenant_idx').on(t.tenantId),
    assignmentIdx: index('form_assignment_dispatches_assignment_idx').on(
      t.tenantId,
      t.assignmentId,
      t.occurredAt,
    ),
    assignmentOccurrenceUx: uniqueIndex('form_assignment_dispatches_assignment_occurrence_ux').on(
      t.tenantId,
      t.assignmentId,
      t.occurredAt,
    ),
    assignmentFk: foreignKey({
      name: 'form_assignment_dispatches_tenant_assignment_fk',
      columns: [t.tenantId, t.assignmentId],
      foreignColumns: [formAssignments.tenantId, formAssignments.id],
    }).onDelete('cascade'),
  }),
)

export const formAssignmentDispatchesRelations = relations(formAssignmentDispatches, ({ one }) => ({
  tenant: one(tenants, {
    fields: [formAssignmentDispatches.tenantId],
    references: [tenants.id],
  }),
  assignment: one(formAssignments, {
    fields: [formAssignmentDispatches.tenantId, formAssignmentDispatches.assignmentId],
    references: [formAssignments.tenantId, formAssignments.id],
  }),
}))
