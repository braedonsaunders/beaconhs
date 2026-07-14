// Management Reviews — annual / scheduled board review of the SH&S
// management system as a whole, distinct from per-document `document_reviews`.
//
// One record covers a date range, references a set of documents that were
// reviewed, captures discussion notes, board decisions, follow-up actions and
// the next-review date. Participants are tracked via the `participants` jsonb
// (array of tenant_user_ids) — kept as jsonb (rather than a child table) for
// parity with the legacy `AttendedID` comma-separated column and to keep the
// API simple. Reviewed documents are normalized below because each review must
// retain the exact immutable document version that the board saw.

import { relations } from 'drizzle-orm'
import {
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers } from './core'
import { documents, documentVersions } from './documents'

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
    // Array of `corrective_actions.id`s that the review spawned.
    actionItemsCreated: jsonb('action_items_created').$type<string[]>().default([]).notNull(),
    chairedByTenantUserId: uuid('chaired_by_tenant_user_id'),
    createdByTenantUserId: uuid('created_by_tenant_user_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('document_management_reviews_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('document_management_reviews_tenant_id_id_ux').on(t.tenantId, t.id),
    periodIdx: index('document_management_reviews_period_idx').on(t.tenantId, t.periodEnd),
    chairedByIdx: index('document_management_reviews_chaired_by_idx').on(
      t.tenantId,
      t.chairedByTenantUserId,
    ),
    createdByIdx: index('document_management_reviews_created_by_idx').on(
      t.tenantId,
      t.createdByTenantUserId,
    ),
    chairedByFk: foreignKey({
      name: 'document_management_reviews_tenant_chaired_by_fk',
      columns: [t.tenantId, t.chairedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
    createdByFk: foreignKey({
      name: 'document_management_reviews_tenant_created_by_fk',
      columns: [t.tenantId, t.createdByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const documentManagementReviewDocuments = pgTable(
  'document_management_review_documents',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    managementReviewId: uuid('management_review_id').notNull(),
    documentId: uuid('document_id').notNull(),
    documentVersionId: uuid('document_version_id').notNull(),
    ...timestamps,
  },
  (t) => ({
    reviewIdx: index('document_management_review_documents_review_idx').on(
      t.tenantId,
      t.managementReviewId,
    ),
    documentVersionIdx: index('document_management_review_documents_doc_version_idx').on(
      t.tenantId,
      t.documentId,
      t.documentVersionId,
    ),
    reviewDocumentUx: uniqueIndex('document_management_review_documents_review_doc_ux').on(
      t.tenantId,
      t.managementReviewId,
      t.documentId,
    ),
    reviewFk: foreignKey({
      name: 'document_management_review_documents_tenant_review_fk',
      columns: [t.tenantId, t.managementReviewId],
      foreignColumns: [documentManagementReviews.tenantId, documentManagementReviews.id],
    }).onDelete('cascade'),
    documentFk: foreignKey({
      name: 'document_management_review_documents_tenant_document_fk',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }),
    documentVersionFk: foreignKey({
      name: 'document_management_review_documents_tenant_doc_version_fk',
      columns: [t.tenantId, t.documentId, t.documentVersionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
    }),
  }),
)

export const documentManagementReviewsRelations = relations(
  documentManagementReviews,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [documentManagementReviews.tenantId],
      references: [tenants.id],
    }),
    chairedBy: one(tenantUsers, {
      fields: [documentManagementReviews.tenantId, documentManagementReviews.chairedByTenantUserId],
      references: [tenantUsers.tenantId, tenantUsers.id],
    }),
    createdBy: one(tenantUsers, {
      fields: [documentManagementReviews.tenantId, documentManagementReviews.createdByTenantUserId],
      references: [tenantUsers.tenantId, tenantUsers.id],
    }),
    reviewedDocuments: many(documentManagementReviewDocuments),
  }),
)

export const documentManagementReviewDocumentsRelations = relations(
  documentManagementReviewDocuments,
  ({ one }) => ({
    managementReview: one(documentManagementReviews, {
      fields: [
        documentManagementReviewDocuments.tenantId,
        documentManagementReviewDocuments.managementReviewId,
      ],
      references: [documentManagementReviews.tenantId, documentManagementReviews.id],
    }),
    document: one(documents, {
      fields: [
        documentManagementReviewDocuments.tenantId,
        documentManagementReviewDocuments.documentId,
      ],
      references: [documents.tenantId, documents.id],
    }),
    documentVersion: one(documentVersions, {
      fields: [
        documentManagementReviewDocuments.tenantId,
        documentManagementReviewDocuments.documentId,
        documentManagementReviewDocuments.documentVersionId,
      ],
      references: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
    }),
  }),
)
