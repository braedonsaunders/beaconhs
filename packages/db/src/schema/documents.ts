// Document library (SDS, policies, procedures), with versioning, acknowledgments,
// periodic review, and curated 'books' for management review.

import { relations, sql } from 'drizzle-orm'
import {
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers, users } from './core'
import { people } from './org'
import { documentTypes, documentCategories } from './document-types'

export const documentStatus = pgEnum('document_status', [
  'draft',
  'published',
  'archived',
  'under_review',
])

export const documents = pgTable(
  'documents',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    typeId: uuid('type_id'),
    categoryId: uuid('category_id'),
    status: documentStatus('status').default('draft').notNull(),
    ownerTenantUserId: uuid('owner_tenant_user_id'),
    reviewFrequencyMonths: integer('review_frequency_months'),
    nextReviewOn: date('next_review_on'),
    // DOCX master copy: the working draft, edited inline in Collabora Writer
    // (page setup, headers/footers, comments and track changes all live in the
    // file). Publishing snapshots it into an immutable document_versions row.
    // Null for file-only documents (uploaded PDFs — see
    // document_versions.contentAttachmentId).
    sourceAttachmentId: uuid('source_attachment_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('documents_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('documents_tenant_id_id_ux').on(t.tenantId, t.id),
    keyUnique: uniqueIndex('documents_tenant_key_live_ux')
      .on(t.tenantId, sql`lower(${t.key})`)
      .where(sql`${t.deletedAt} IS NULL`),
    typeIdx: index('documents_type_idx').on(t.tenantId, t.typeId),
    categoryIdx: index('documents_category_idx').on(t.tenantId, t.categoryId),
    ownerIdx: index('documents_owner_idx').on(t.tenantId, t.ownerTenantUserId),
    statusIdx: index('documents_status_idx').on(t.tenantId, t.status),
    reviewIdx: index('documents_review_idx').on(t.tenantId, t.nextReviewOn),
    typeFk: foreignKey({
      name: 'documents_tenant_type_fk',
      columns: [t.tenantId, t.typeId],
      foreignColumns: [documentTypes.tenantId, documentTypes.id],
    }),
    categoryFk: foreignKey({
      name: 'documents_tenant_category_fk',
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [documentCategories.tenantId, documentCategories.id],
    }),
    ownerFk: foreignKey({
      name: 'documents_tenant_owner_fk',
      columns: [t.tenantId, t.ownerTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const documentVersions = pgTable(
  'document_versions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    // Legacy controlled documents use exact decimal revisions (for example
    // 1.1 and 1.2). Keep one decimal place in PostgreSQL instead of folding
    // distinct immutable versions into the same integer identity.
    version: numeric('version', { precision: 18, scale: 1, mode: 'number' }).notNull(),
    // File-only documents (uploaded PDF or other artifact) — the uploaded file
    // IS the version content.
    contentAttachmentId: uuid('content_attachment_id'),
    // Authored documents: immutable snapshot of the DOCX master at publish
    // time, plus the worker-rendered PDF (what readers see — identical
    // pagination on every device) and extracted plain text (search / AI).
    docxAttachmentId: uuid('docx_attachment_id'),
    pdfAttachmentId: uuid('pdf_attachment_id'),
    textContent: text('text_content'),
    // PDF render lifecycle (worker writes these): 'pending' | 'processing' |
    // 'complete' | 'failed'.
    renderStatus: text('render_status'),
    renderError: text('render_error'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: text('published_by').references(() => users.id),
    changelog: text('changelog'),
    ...timestamps,
  },
  (t) => ({
    documentIdx: uniqueIndex('document_versions_document_idx').on(t.documentId, t.version),
    tenantIdx: index('document_versions_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('document_versions_tenant_id_id_ux').on(t.tenantId, t.id),
    tenantDocumentIdUx: uniqueIndex('document_versions_tenant_document_id_ux').on(
      t.tenantId,
      t.documentId,
      t.id,
    ),
    tenantDocumentIdx: index('document_versions_tenant_document_idx').on(t.tenantId, t.documentId),
    documentFk: foreignKey({
      name: 'document_versions_tenant_document_fk',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete('cascade'),
  }),
)

// A group sign-off "sheet": one facilitator-led session against a document
// version that collects many people's signatures on a single device
// (toolbox-talk style). Each attendee still writes their own
// document_acknowledgments row (with session_id set) so the per-person
// compliance engine is satisfied exactly as it is for self-service acks.
export const documentAcknowledgmentSessions = pgTable(
  'document_acknowledgment_sessions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    versionId: uuid('version_id').notNull(),
    title: text('title'), // defaults to the document title in the UI
    location: text('location'),
    notes: text('notes'),
    conductedByTenantUserId: uuid('conducted_by_tenant_user_id'),
    conductedAt: timestamp('conducted_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    docIdx: index('document_ack_sessions_doc_idx').on(t.tenantId, t.documentId),
    tenantIdx: index('document_ack_sessions_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('document_ack_sessions_tenant_id_id_ux').on(t.tenantId, t.id),
    versionIdx: index('document_ack_sessions_version_idx').on(t.tenantId, t.versionId),
    documentVersionIdx: index('document_ack_sessions_tenant_doc_version_idx').on(
      t.tenantId,
      t.documentId,
      t.versionId,
    ),
    tenantDocumentVersionIdUx: uniqueIndex('document_ack_sessions_tenant_doc_version_id_ux').on(
      t.tenantId,
      t.documentId,
      t.versionId,
      t.id,
    ),
    conductedByIdx: index('document_ack_sessions_conducted_by_idx').on(
      t.tenantId,
      t.conductedByTenantUserId,
    ),
    documentFk: foreignKey({
      name: 'document_ack_sessions_tenant_document_fk',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete('cascade'),
    versionFk: foreignKey({
      name: 'document_ack_sessions_tenant_doc_version_fk',
      columns: [t.tenantId, t.documentId, t.versionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
    }),
    conductedByFk: foreignKey({
      name: 'document_ack_sessions_tenant_conducted_by_fk',
      columns: [t.tenantId, t.conductedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

export const documentAcknowledgments = pgTable(
  'document_acknowledgments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    versionId: uuid('version_id').notNull(),
    personId: uuid('person_id').notNull(),
    // Null for self-service acks; set when recorded via a group sign-off sheet.
    sessionId: uuid('session_id'),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).defaultNow().notNull(),
    signatureAttachmentId: uuid('signature_attachment_id'),
    ...timestamps,
  },
  (t) => ({
    docPersonIdx: index('document_acks_doc_person_idx').on(t.tenantId, t.documentId, t.personId),
    sessionIdx: index('document_acks_session_idx').on(t.tenantId, t.sessionId),
    sessionDocumentVersionIdx: index('document_acks_tenant_doc_version_session_idx').on(
      t.tenantId,
      t.documentId,
      t.versionId,
      t.sessionId,
    ),
    tenantIdx: index('document_acks_tenant_idx').on(t.tenantId),
    versionIdx: index('document_acks_version_idx').on(t.tenantId, t.versionId),
    personIdx: index('document_acks_person_idx').on(t.tenantId, t.personId),
    documentVersionPersonUx: uniqueIndex('document_acks_tenant_doc_version_person_ux').on(
      t.tenantId,
      t.documentId,
      t.versionId,
      t.personId,
    ),
    documentFk: foreignKey({
      name: 'document_acks_tenant_document_fk',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete('cascade'),
    versionFk: foreignKey({
      name: 'document_acks_tenant_doc_version_fk',
      columns: [t.tenantId, t.documentId, t.versionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
    }),
    sessionFk: foreignKey({
      name: 'document_acks_tenant_doc_version_session_fk',
      columns: [t.tenantId, t.documentId, t.versionId, t.sessionId],
      foreignColumns: [
        documentAcknowledgmentSessions.tenantId,
        documentAcknowledgmentSessions.documentId,
        documentAcknowledgmentSessions.versionId,
        documentAcknowledgmentSessions.id,
      ],
    }),
    personFk: foreignKey({
      name: 'document_acks_tenant_person_fk',
      columns: [t.tenantId, t.personId],
      foreignColumns: [people.tenantId, people.id],
    }).onDelete('cascade'),
  }),
)

export const documentReviewOutcome = pgEnum('document_review_outcome', [
  'approved_no_change',
  'updated',
  'retired',
])

export const documentReviewStatus = pgEnum('document_review_status', ['in_progress', 'completed'])

export const documentReviews = pgTable(
  'document_reviews',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull(),
    // Reviews are immutable evidence about one exact published version. A
    // later publish must never change what an earlier review appears to cover.
    documentVersionId: uuid('document_version_id').notNull(),
    reviewedByTenantUserId: uuid('reviewed_by_tenant_user_id').notNull(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(),
    status: documentReviewStatus('status').default('completed').notNull(),
    // Historical systems did not always capture an outcome. Null means the
    // source did not record one; it must never be rewritten as an approval.
    outcome: documentReviewOutcome('outcome'),
    nextReviewOn: date('next_review_on'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    docIdx: index('document_reviews_doc_idx').on(t.tenantId, t.documentId, t.reviewedAt),
    tenantIdx: index('document_reviews_tenant_idx').on(t.tenantId),
    documentVersionIdx: index('document_reviews_document_version_idx').on(
      t.tenantId,
      t.documentId,
      t.documentVersionId,
    ),
    reviewedByIdx: index('document_reviews_reviewed_by_idx').on(
      t.tenantId,
      t.reviewedByTenantUserId,
    ),
    documentFk: foreignKey({
      name: 'document_reviews_tenant_document_fk',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete('cascade'),
    documentVersionFk: foreignKey({
      name: 'document_reviews_tenant_doc_version_fk',
      columns: [t.tenantId, t.documentId, t.documentVersionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
    }),
    reviewedByFk: foreignKey({
      name: 'document_reviews_tenant_reviewed_by_fk',
      columns: [t.tenantId, t.reviewedByTenantUserId],
      foreignColumns: [tenantUsers.tenantId, tenantUsers.id],
    }),
  }),
)

// Curated bundle of documents that publishes as a single PDF.
// Ordered membership lives in document_book_items (see document-books.ts).
export const documentBookStatus = pgEnum('document_book_status', ['draft', 'published'])

export const documentBooks = pgTable(
  'document_books',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default(''),
    description: text('description'),
    typeId: uuid('type_id'),
    categoryId: uuid('category_id'),
    reviewFrequencyMonths: integer('review_frequency_months'),
    nextReviewOn: date('next_review_on'),
    status: documentBookStatus('status').default('draft').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByUserId: text('published_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('document_books_tenant_idx').on(t.tenantId),
    tenantIdIdUx: uniqueIndex('document_books_tenant_id_id_ux').on(t.tenantId, t.id),
    typeIdx: index('document_books_type_idx').on(t.tenantId, t.typeId),
    categoryIdx: index('document_books_category_idx').on(t.tenantId, t.categoryId),
    statusIdx: index('document_books_status_idx').on(t.tenantId, t.status),
    typeFk: foreignKey({
      name: 'document_books_tenant_type_fk',
      columns: [t.tenantId, t.typeId],
      foreignColumns: [documentTypes.tenantId, documentTypes.id],
    }),
    categoryFk: foreignKey({
      name: 'document_books_tenant_category_fk',
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [documentCategories.tenantId, documentCategories.id],
    }),
  }),
)

export const documentsRelations = relations(documents, ({ one, many }) => ({
  tenant: one(tenants, { fields: [documents.tenantId], references: [tenants.id] }),
  versions: many(documentVersions),
  acknowledgments: many(documentAcknowledgments),
  reviews: many(documentReviews),
}))

export const documentAcknowledgmentSessionsRelations = relations(
  documentAcknowledgmentSessions,
  ({ one, many }) => ({
    document: one(documents, {
      fields: [documentAcknowledgmentSessions.tenantId, documentAcknowledgmentSessions.documentId],
      references: [documents.tenantId, documents.id],
    }),
    version: one(documentVersions, {
      fields: [
        documentAcknowledgmentSessions.tenantId,
        documentAcknowledgmentSessions.documentId,
        documentAcknowledgmentSessions.versionId,
      ],
      references: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
    }),
    acknowledgments: many(documentAcknowledgments),
  }),
)

export const documentAcknowledgmentsRelations = relations(documentAcknowledgments, ({ one }) => ({
  session: one(documentAcknowledgmentSessions, {
    fields: [
      documentAcknowledgments.tenantId,
      documentAcknowledgments.documentId,
      documentAcknowledgments.versionId,
      documentAcknowledgments.sessionId,
    ],
    references: [
      documentAcknowledgmentSessions.tenantId,
      documentAcknowledgmentSessions.documentId,
      documentAcknowledgmentSessions.versionId,
      documentAcknowledgmentSessions.id,
    ],
  }),
  person: one(people, {
    fields: [documentAcknowledgments.tenantId, documentAcknowledgments.personId],
    references: [people.tenantId, people.id],
  }),
}))

export const documentReviewsRelations = relations(documentReviews, ({ one }) => ({
  document: one(documents, {
    fields: [documentReviews.tenantId, documentReviews.documentId],
    references: [documents.tenantId, documents.id],
  }),
  documentVersion: one(documentVersions, {
    fields: [
      documentReviews.tenantId,
      documentReviews.documentId,
      documentReviews.documentVersionId,
    ],
    references: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
  }),
  reviewedBy: one(tenantUsers, {
    fields: [documentReviews.tenantId, documentReviews.reviewedByTenantUserId],
    references: [tenantUsers.tenantId, tenantUsers.id],
  }),
}))
