// Document Types + Categories — lookup tables that classify documents.
//
// Both provide FK-backed rows that admins can manage.
//
// Categories form a tenant-scoped tree (parent_id nullable), for example
// Safety / SDS / Acids.

import { relations, sql } from 'drizzle-orm'
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
    // Sibling names are the user-visible identity of a category. Deleted rows
    // must not reserve a name forever, and top-level NULL parents must compare
    // equal (Postgres normally treats every NULL as distinct in a unique
    // index), so normalize parent + name as index expressions.
    activeParentNameUx: uniqueIndex('document_categories_active_parent_name_ux')
      .on(t.tenantId, sql`coalesce(${t.parentId}::text, '')`, sql`lower(btrim(${t.name}))`)
      .where(sql`${t.deletedAt} is null`),
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
