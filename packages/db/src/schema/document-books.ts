// Document Books — orderable groupings of documents that publish as a single PDF.
// The `document_books` table itself lives in documents.ts (it predates this file).
// Ordered membership is normalized here so drag-reorder and add/remove operations
// are relational, tenant-scoped, and concurrency-safe.

import { relations } from 'drizzle-orm'
import { index, integer, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, timestamps } from './_helpers'
import { tenants } from './core'
import { documentBooks, documents } from './documents'

// Note: the `documentBookStatus` enum and `documentBooks` table live in documents.ts
// (they predate this file). Import from there directly.

export const documentBookItems = pgTable(
  'document_book_items',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id')
      .notNull()
      .references(() => documentBooks.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    bookIdx: index('document_book_items_book_idx').on(t.bookId, t.position),
    tenantIdx: index('document_book_items_tenant_idx').on(t.tenantId),
    bookDocUx: uniqueIndex('document_book_items_book_doc_ux').on(t.bookId, t.documentId),
  }),
)

export const documentBookItemsRelations = relations(documentBookItems, ({ one }) => ({
  tenant: one(tenants, { fields: [documentBookItems.tenantId], references: [tenants.id] }),
  book: one(documentBooks, {
    fields: [documentBookItems.bookId],
    references: [documentBooks.id],
  }),
  document: one(documents, {
    fields: [documentBookItems.documentId],
    references: [documents.id],
  }),
}))
