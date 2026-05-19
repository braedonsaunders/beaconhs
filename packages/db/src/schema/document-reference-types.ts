// Document Reference Types + Categories — lookup tables that classify
// reference-library entries.
//
// The existing `document_references.category` text column is preserved for
// back-compat; new code joins through `typeId` / `categoryId` to these tables.
// Categories form a tenant-scoped tree (parent_id nullable), mirroring legacy
// DOCUMENTATIONREFERENCECATEGORY.

import { relations } from 'drizzle-orm'
import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { id, softDelete, timestamps } from './_helpers'
import { tenants } from './core'

export const documentReferenceTypes = pgTable(
  'document_reference_types',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // slug, unique per tenant
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('document_reference_types_tenant_idx').on(t.tenantId),
    tenantKeyUx: uniqueIndex('document_reference_types_tenant_key_ux').on(t.tenantId, t.key),
  }),
)

export const documentReferenceCategories = pgTable(
  'document_reference_categories',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): any => documentReferenceCategories.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    description: text('description'),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('document_reference_categories_tenant_idx').on(t.tenantId),
    parentIdx: index('document_reference_categories_parent_idx').on(t.parentId),
    tenantNameUx: uniqueIndex('document_reference_categories_tenant_name_ux').on(
      t.tenantId,
      t.name,
    ),
  }),
)

export const documentReferenceTypesRelations = relations(documentReferenceTypes, ({ one }) => ({
  tenant: one(tenants, { fields: [documentReferenceTypes.tenantId], references: [tenants.id] }),
}))

export const documentReferenceCategoriesRelations = relations(
  documentReferenceCategories,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [documentReferenceCategories.tenantId],
      references: [tenants.id],
    }),
    parent: one(documentReferenceCategories, {
      fields: [documentReferenceCategories.parentId],
      references: [documentReferenceCategories.id],
    }),
    children: many(documentReferenceCategories),
  }),
)
