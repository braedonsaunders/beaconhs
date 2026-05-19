// Management Reviews — annual / scheduled board review of the SH&S
// management system as a whole, distinct from per-document `document_reviews`.
//
// One record covers a date range, references a set of documents that were
// reviewed, captures discussion notes, board decisions, follow-up actions and
// the next-review date. Participants are tracked via the `participants` jsonb
// (array of tenant_user_ids) — kept as jsonb (rather than a child table) for
// parity with the legacy `AttendedID` comma-separated column and to keep the
// API simple.

import { relations } from 'drizzle-orm'
import { date, index, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'

export const documentManagementReviews = pgTable(
  'document_management_reviews',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    periodStart: date('period_start'),
    periodEnd: date('period_end').notNull(),
    nextReviewOn: date('next_review_on'),
    discussionNotes: text('discussion_notes'),
    decisions: text('decisions'),
    // Array of tenant_user_ids that attended / signed-off on the review.
    participants: jsonb('participants').$type<string[]>().default([]).notNull(),
    // Array of `document.id`s that were reviewed in this session.
    documentsReviewed: jsonb('documents_reviewed').$type<string[]>().default([]).notNull(),
    // Array of `corrective_actions.id`s that the review spawned.
    actionItemsCreated: jsonb('action_items_created').$type<string[]>().default([]).notNull(),
    chairedByTenantUserId: uuid('chaired_by_tenant_user_id').references(() => tenantUsers.id),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('document_management_reviews_tenant_idx').on(t.tenantId),
    periodIdx: index('document_management_reviews_period_idx').on(t.tenantId, t.periodEnd),
  }),
)

export const documentManagementReviewsRelations = relations(
  documentManagementReviews,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [documentManagementReviews.tenantId],
      references: [tenants.id],
    }),
    chairedBy: one(tenantUsers, {
      fields: [documentManagementReviews.chairedByTenantUserId],
      references: [tenantUsers.id],
    }),
    createdBy: one(tenantUsers, {
      fields: [documentManagementReviews.createdByTenantUserId],
      references: [tenantUsers.id],
    }),
  }),
)
