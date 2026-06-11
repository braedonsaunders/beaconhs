// Generic, admin-managed DATA SOURCES — the binding substrate for data-bound
// app elements (lookup auto-fill, cascading dropdowns, data-table, KPI/chart).
//
// A data source is a named, tenant-scoped, queryable collection of rows with a
// declared column shape. Two kinds:
//   - 'reference': rows are curated in the admin UI and stored in
//     `data_source_rows` (e.g. Sites → Areas → Sub-areas, an equipment register,
//     a contractor list). These power cascading dropdowns + lookup auto-fill.
//   - 'responses': rows are DERIVED at query time from submitted form_responses
//     of a chosen template (each response's `data` map is one row). These power
//     live KPIs / charts over real app data. No rows are stored here.
//
// The query/aggregate layer lives in apps/web (forms/_lib/data-sources.ts) and
// is RLS-bound; the browser only ever authors bindings — it never queries
// directly across tenants.

import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { id, timestamps, softDelete } from './_helpers'
import { tenants, tenantUsers } from './core'

// Column value kinds a data source declares. Kept deliberately small — these
// drive input rendering in the admin row editor and coercion in aggregates.
export type DataSourceColumnType = 'text' | 'number' | 'date' | 'boolean'

export type DataSourceColumn = {
  key: string
  label: string
  type: DataSourceColumnType
}

// Config bag, kind-specific. For 'responses': which template feeds the rows and
// an optional status filter. Empty for 'reference'.
export type DataSourceConfig = {
  // 'responses' kind:
  templateId?: string
  // restrict derived rows to these response statuses (default: submitted only)
  statuses?: string[]
}

export const dataSourceKind = pgEnum('data_source_kind', ['reference', 'responses'])

export const dataSources = pgTable(
  'data_sources',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // Stable slug referenced by field bindings (field.binding.sourceKey). Unique
    // per tenant so renaming the display name never breaks existing apps.
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: dataSourceKind('kind').notNull().default('reference'),
    // Declared column shape (order matters — drives table column order).
    columns: jsonb('columns').$type<DataSourceColumn[]>().notNull().default([]),
    config: jsonb('config').$type<DataSourceConfig>().notNull().default({}),
    createdByTenantUserId: uuid('created_by_tenant_user_id').references(() => tenantUsers.id),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    tenantIdx: index('data_sources_tenant_idx').on(t.tenantId),
    tenantKeyUx: uniqueIndex('data_sources_tenant_key_ux').on(t.tenantId, t.key),
  }),
)

export const dataSourceRows = pgTable(
  'data_source_rows',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    dataSourceId: uuid('data_source_id')
      .notNull()
      .references(() => dataSources.id, { onDelete: 'cascade' }),
    // Row values keyed by column key. Untyped at the DB layer; the column
    // declarations on the parent source describe the intended shape.
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    // Manual ordering within the source.
    position: integer('position').notNull().default(0),
    ...timestamps,
    ...softDelete,
  },
  (t) => ({
    sourceIdx: index('data_source_rows_source_idx').on(t.dataSourceId, t.position),
    tenantIdx: index('data_source_rows_tenant_idx').on(t.tenantId),
  }),
)

export const dataSourcesRelations = relations(dataSources, ({ one, many }) => ({
  tenant: one(tenants, { fields: [dataSources.tenantId], references: [tenants.id] }),
  rows: many(dataSourceRows),
}))

export const dataSourceRowsRelations = relations(dataSourceRows, ({ one }) => ({
  source: one(dataSources, {
    fields: [dataSourceRows.dataSourceId],
    references: [dataSources.id],
  }),
}))

export type DataSource = typeof dataSources.$inferSelect
export type DataSourceRow = typeof dataSourceRows.$inferSelect
