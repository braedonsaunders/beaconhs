// Document Reference Library — external file or URL pointers (MSDS, manuals, vendor docs).
// Lighter-weight than `documents` (no versioning, no acknowledgments) because the
// referenced material lives outside the platform.

import { relations } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'
import { documentReferenceTypes } from './document-reference-types'

export const documentReferenceKind = pgEnum('document_reference_kind', ['url', 'attachment'])

export const documentReferences = pgTable(
  'document_references',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    category: text('category'), // 'sds' | 'manual' | 'external' | …
    typeId: uuid('type_id').references(() => documentReferenceTypes.id),
    kind: documentReferenceKind('kind').notNull(),
    url: text('url'),
    attachmentId: uuid('attachment_id'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('document_references_tenant_idx').on(t.tenantId),
    categoryIdx: index('document_references_category_idx').on(t.tenantId, t.category),
  }),
)

export const documentReferencesRelations = relations(documentReferences, ({ one }) => ({
  tenant: one(tenants, { fields: [documentReferences.tenantId], references: [tenants.id] }),
}))
