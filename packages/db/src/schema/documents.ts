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
  uuid,
} from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants, tenantUsers, users } from './core'
import { people, trades } from './org'

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
    category: text('category'), // 'sds' | 'policy' | 'procedure' | 'form' | …
    status: documentStatus('status').default('draft').notNull(),
    ownerTenantUserId: uuid('owner_tenant_user_id').references(() => tenantUsers.id),
    reviewFrequencyMonths: integer('review_frequency_months'),
    nextReviewOn: date('next_review_on'),
    requiredForRoleKeys: jsonb('required_for_role_keys').$type<string[]>().default([]).notNull(),
    requiredForTradeIds: jsonb('required_for_trade_ids').$type<string[]>().default([]).notNull(),
    printHeader: boolean('print_header').default(true).notNull(),
    printFooter: boolean('print_footer').default(true).notNull(),
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
    contentAttachmentId: uuid('content_attachment_id'),
    contentMarkdown: text('content_markdown'), // for in-app authored docs
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
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }).defaultNow().notNull(),
    signatureAttachmentId: uuid('signature_attachment_id'),
    ...timestamps,
  },
  (t) => ({
    docPersonIdx: index('document_acks_doc_person_idx').on(t.documentId, t.personId),
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
    category: text('category'),
    status: documentBookStatus('status').default('draft').notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedByUserId: text('published_by_user_id').references(() => users.id),
    // Legacy jsonb representation — kept for back-compat; new readers use document_book_items.
    contents: jsonb('contents').$type<{ documentId: string; versionId?: string }[]>().default([]).notNull(),
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
