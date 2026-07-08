// Document library (SDS, policies, procedures), with versioning, acknowledgments,
// periodic review, and curated 'books' for management review.

import { relations } from 'drizzle-orm'
import {
  boolean,
  date,
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
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers, users } from './core'
import { people, trades } from './org'
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
    category: text('category'), // legacy freeform; superseded by categoryId
    typeId: uuid('type_id').references(() => documentTypes.id),
    categoryId: uuid('category_id').references(() => documentCategories.id),
    status: documentStatus('status').default('draft').notNull(),
    ownerTenantUserId: uuid('owner_tenant_user_id').references(() => tenantUsers.id),
    reviewFrequencyMonths: integer('review_frequency_months'),
    nextReviewOn: date('next_review_on'),
    requiredForRoleKeys: jsonb('required_for_role_keys').$type<string[]>().default([]).notNull(),
    requiredForTradeIds: jsonb('required_for_trade_ids').$type<string[]>().default([]).notNull(),
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
    keyIdx: index('documents_key_idx').on(t.tenantId, t.key),
    statusIdx: index('documents_status_idx').on(t.tenantId, t.status),
    reviewIdx: index('documents_review_idx').on(t.tenantId, t.nextReviewOn),
  }),
)

export const documentVersions = pgTable(
  'document_versions',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
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
    documentIdx: index('document_versions_document_idx').on(t.documentId, t.version),
    tenantIdx: index('document_versions_tenant_idx').on(t.tenantId),
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
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => documentVersions.id),
    title: text('title'), // defaults to the document title in the UI
    location: text('location'),
    notes: text('notes'),
    conductedByTenantUserId: uuid('conducted_by_tenant_user_id').references(() => tenantUsers.id),
    conductedAt: timestamp('conducted_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    docIdx: index('document_ack_sessions_doc_idx').on(t.documentId),
    tenantIdx: index('document_ack_sessions_tenant_idx').on(t.tenantId),
  }),
)

export const documentAcknowledgments = pgTable(
  'document_acknowledgments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => documentVersions.id),
    personId: uuid('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    // Null for self-service acks; set when recorded via a group sign-off sheet.
    sessionId: uuid('session_id').references(() => documentAcknowledgmentSessions.id, {
      onDelete: 'set null',
    }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).defaultNow().notNull(),
    signatureAttachmentId: uuid('signature_attachment_id'),
    ...timestamps,
  },
  (t) => ({
    docPersonIdx: index('document_acks_doc_person_idx').on(t.documentId, t.personId),
    sessionIdx: index('document_acks_session_idx').on(t.sessionId),
    tenantIdx: index('document_acks_tenant_idx').on(t.tenantId),
  }),
)

export const documentReviewOutcome = pgEnum('document_review_outcome', [
  'approved_no_change',
  'updated',
  'retired',
])

export const documentReviews = pgTable(
  'document_reviews',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    reviewedByTenantUserId: uuid('reviewed_by_tenant_user_id')
      .notNull()
      .references(() => tenantUsers.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).defaultNow().notNull(),
    outcome: documentReviewOutcome('outcome').notNull(),
    nextReviewOn: date('next_review_on'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => ({
    docIdx: index('document_reviews_doc_idx').on(t.documentId, t.reviewedAt),
    tenantIdx: index('document_reviews_tenant_idx').on(t.tenantId),
  }),
)

// Curated bundle of documents that publishes as a single PDF.
// Ordered membership lives in document_book_items (see document-books.ts).
// Legacy `contents` jsonb is preserved for back-compat but new code should write items.
export const documentBookStatus = pgEnum('document_book_status', ['draft', 'published'])

export const documentBooks = pgTable(
  'document_books',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Display fields. `title` is the canonical column going forward; `name` is the
    // legacy column kept around to avoid breaking older inserts.
    title: text('title').notNull().default(''),
    name: text('name').notNull().default(''),
    description: text('description'),
    category: text('category'), // legacy freeform; superseded by categoryId
    typeId: uuid('type_id').references(() => documentTypes.id),
    categoryId: uuid('category_id').references(() => documentCategories.id),
    reviewFrequencyMonths: integer('review_frequency_months'),
    nextReviewOn: date('next_review_on'),
    status: documentBookStatus('status').default('draft').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByUserId: text('published_by_user_id').references(() => users.id),
    // Legacy jsonb representation — kept for back-compat; new readers use document_book_items.
    contents: jsonb('contents')
      .$type<{ documentId: string; versionId?: string }[]>()
      .default([])
      .notNull(),
    ...timestamps,
  },
  (t) => ({
    tenantIdx: index('document_books_tenant_idx').on(t.tenantId),
    statusIdx: index('document_books_status_idx').on(t.tenantId, t.status),
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
      fields: [documentAcknowledgmentSessions.documentId],
      references: [documents.id],
    }),
    version: one(documentVersions, {
      fields: [documentAcknowledgmentSessions.versionId],
      references: [documentVersions.id],
    }),
    acknowledgments: many(documentAcknowledgments),
  }),
)

export const documentAcknowledgmentsRelations = relations(documentAcknowledgments, ({ one }) => ({
  session: one(documentAcknowledgmentSessions, {
    fields: [documentAcknowledgments.sessionId],
    references: [documentAcknowledgmentSessions.id],
  }),
  person: one(people, {
    fields: [documentAcknowledgments.personId],
    references: [people.id],
  }),
}))
