// Document Books — orderable groupings of documents that publish as a single PDF.
// The `document_books` table itself lives in documents.ts (it predates this file).
// Ordered membership is normalized here so drag-reorder and add/remove operations
// are relational, tenant-scoped, and concurrency-safe.

import { relations } from 'drizzle-orm'
import { foreignKey, index, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { documentBooks, documents, documentVersions } from './documents'

// Note: the `documentBookStatus` enum and `documentBooks` table live in documents.ts
// (they predate this file). Import from there directly.

export const documentBookItems = pgTable(
  'document_book_items',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id').notNull(),
    documentId: uuid('document_id').notNull(),
    // Null while the book is a draft. Publishing pins every item to the exact
    // immutable version rendered for readers.
    documentVersionId: uuid('document_version_id'),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    bookIdx: index('document_book_items_book_idx').on(t.tenantId, t.bookId, t.position),
    tenantIdx: index('document_book_items_tenant_idx').on(t.tenantId),
    documentIdx: index('document_book_items_document_idx').on(t.tenantId, t.documentId),
    documentVersionIdx: index('document_book_items_document_version_idx').on(
      t.tenantId,
      t.documentId,
      t.documentVersionId,
    ),
    bookDocUx: uniqueIndex('document_book_items_book_doc_ux').on(t.bookId, t.documentId),
    bookFk: foreignKey({
      name: 'document_book_items_tenant_book_fk',
      columns: [t.tenantId, t.bookId],
      foreignColumns: [documentBooks.tenantId, documentBooks.id],
    }).onDelete('cascade'),
    documentFk: foreignKey({
      name: 'document_book_items_tenant_document_fk',
      columns: [t.tenantId, t.documentId],
      foreignColumns: [documents.tenantId, documents.id],
    }).onDelete('cascade'),
    documentVersionFk: foreignKey({
      name: 'document_book_items_tenant_doc_version_fk',
      columns: [t.tenantId, t.documentId, t.documentVersionId],
      foreignColumns: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
    }),
  }),
)

export const documentBookItemsRelations = relations(documentBookItems, ({ one }) => ({
  tenant: one(tenants, { fields: [documentBookItems.tenantId], references: [tenants.id] }),
  book: one(documentBooks, {
    fields: [documentBookItems.tenantId, documentBookItems.bookId],
    references: [documentBooks.tenantId, documentBooks.id],
  }),
  document: one(documents, {
    fields: [documentBookItems.tenantId, documentBookItems.documentId],
    references: [documents.tenantId, documents.id],
  }),
  documentVersion: one(documentVersions, {
    fields: [
      documentBookItems.tenantId,
      documentBookItems.documentId,
      documentBookItems.documentVersionId,
    ],
    references: [documentVersions.tenantId, documentVersions.documentId, documentVersions.id],
  }),
}))
