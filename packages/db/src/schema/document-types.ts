// Document Types + Categories — lookup tables that classify documents.
//
// Both replace the bare `documents.category` text column with proper FK-backed
// rows that admins can manage. The existing `documents.category` text column is
// preserved for back-compat (and remains the source of truth on the list page
// filter chips), while new `typeId` / `categoryId` columns join through to the
// lookups.
//
// Categories form a tenant-scoped tree (parent_id nullable) so admins can mirror
// their legacy DOCUMENTATIONCATEGORY structure (e.g. Safety / SDS / Acids).

import { relations } from 'drizzle-orm'
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'

export const documentTypes = pgTable(
  'document_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // slug, unique per tenant
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'), // hex like '#0f766e'
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('document_types_tenant_idx').on(t.tenantId),
    tenantKeyUx: uniqueIndex('document_types_tenant_key_ux').on(t.tenantId, t.key),
  }),
)

export const documentCategories = pgTable(
  'document_categories',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): any => documentCategories.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('document_categories_tenant_idx').on(t.tenantId),
    parentIdx: index('document_categories_parent_idx').on(t.parentId),
    tenantNameUx: uniqueIndex('document_categories_tenant_name_ux').on(t.tenantId, t.name),
  }),
)

export const documentTypesRelations = relations(documentTypes, ({ one }) => ({
  tenant: one(tenants, { fields: [documentTypes.tenantId], references: [tenants.id] }),
}))

export const documentCategoriesRelations = relations(documentCategories, ({ one, many }) => ({
  tenant: one(tenants, { fields: [documentCategories.tenantId], references: [tenants.id] }),
  parent: one(documentCategories, {
    fields: [documentCategories.parentId],
    references: [documentCategories.id],
  }),
  children: many(documentCategories),
}))
