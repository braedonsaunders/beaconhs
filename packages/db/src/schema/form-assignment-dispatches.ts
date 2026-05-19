// Dispatch ledger for scheduled form_assignments.
//
// The form-assignment scanner walks form_assignments where mode='scheduled' and
// the assignment cron is due. For each due assignment it inserts one row here
// per fire, then fans out notifications to the assignees. The scanner uses the
// max(occurredAt) for an assignment to decide whether it's already fired in the
// current minute window — keeps the scanner idempotent without adding a column
// on form_assignments itself.

import { relations } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
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
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => formAssignments.id, { onDelete: 'cascade' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    // 'scheduled' | 'skipped' | 'failed'
    status: text('status').notNull().default('scheduled'),
    // Audience snapshot — user ids notified at fire time (for audit)
    audienceUserIds: jsonb('audience_user_ids').$type<string[]>().default([]).notNull(),
    error: text('error'),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('form_assignment_dispatches_tenant_idx').on(t.tenantId),
    assignmentIdx: index('form_assignment_dispatches_assignment_idx').on(t.assignmentId, t.occurredAt),
  }),
)

export const formAssignmentDispatchesRelations = relations(formAssignmentDispatches, ({ one }) => ({
  tenant: one(tenants, {
    fields: [formAssignmentDispatches.tenantId],
    references: [tenants.id],
  }),
  assignment: one(formAssignments, {
    fields: [formAssignmentDispatches.assignmentId],
    references: [formAssignments.id],
  }),
}))
