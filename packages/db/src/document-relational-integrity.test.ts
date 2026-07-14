import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0011_famous_hammerhead.sql')

type TableConfig = ReturnType<typeof getTableConfig>
type DeleteAction = 'cascade' | 'no action' | 'set null'

const cascadeRelationships = [
  'document_acknowledgment_sessions.tenant_id,document_id->documents.tenant_id,id',
  'document_acknowledgments.tenant_id,document_id->documents.tenant_id,id',
  'document_acknowledgments.tenant_id,person_id->people.tenant_id,id',
  'document_assignment_audience.tenant_id,assignment_id->document_assignments.tenant_id,id',
  'document_assignments.tenant_id,document_id->documents.tenant_id,id',
  'document_book_items.tenant_id,book_id->document_books.tenant_id,id',
  'document_book_items.tenant_id,document_id->documents.tenant_id,id',
  'document_reviews.tenant_id,document_id->documents.tenant_id,id',
  'document_versions.tenant_id,document_id->documents.tenant_id,id',
] as const

const noActionRelationships = [
  'document_acknowledgment_sessions.tenant_id,conducted_by_tenant_user_id->tenant_users.tenant_id,id',
  'document_acknowledgment_sessions.tenant_id,version_id->document_versions.tenant_id,id',
  'document_acknowledgments.tenant_id,version_id->document_versions.tenant_id,id',
  'document_assignments.tenant_id,assigned_by_tenant_user_id->tenant_users.tenant_id,id',
  'document_books.tenant_id,category_id->document_categories.tenant_id,id',
  'document_books.tenant_id,type_id->document_types.tenant_id,id',
  'document_management_reviews.tenant_id,chaired_by_tenant_user_id->tenant_users.tenant_id,id',
  'document_management_reviews.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
  'document_reviews.tenant_id,reviewed_by_tenant_user_id->tenant_users.tenant_id,id',
  'documents.tenant_id,category_id->document_categories.tenant_id,id',
  'documents.tenant_id,owner_tenant_user_id->tenant_users.tenant_id,id',
  'documents.tenant_id,type_id->document_types.tenant_id,id',
] as const

const partialSetNullRelationships = [
  'document_acknowledgments.tenant_id,session_id->document_acknowledgment_sessions.tenant_id,id',
  'document_categories.tenant_id,parent_id->document_categories.tenant_id,id',
] as const

const retiredDocumentTables = new Set(['document_assignments', 'document_assignment_audience'])
const supersededDocumentRelationships = new Set([
  'document_acknowledgment_sessions.tenant_id,version_id->document_versions.tenant_id,id',
  'document_acknowledgments.tenant_id,version_id->document_versions.tenant_id,id',
])

function allTableConfigs(): TableConfig[] {
  const byName = new Map<string, TableConfig>()
  for (const value of Object.values(schema)) {
    if (!value || typeof value !== 'object') continue
    try {
      const config = getTableConfig(value as Parameters<typeof getTableConfig>[0])
      if (config.name && config.columns.length > 0) byName.set(config.name, config)
    } catch {
      // enums, relations, and type-only exports are not tables
    }
  }
  return [...byName.values()]
}

function manifest() {
  return [
    ...migrationSql.matchAll(
      /^\s+\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '(cascade|no action|set null)'\)[,;](?:-->.*)?$/gm,
    ),
  ].map((match) => ({
    relationName: match[1]!,
    childTable: match[2]!,
    childColumn: match[3]!,
    parentTable: match[4]!,
    constraintName: match[5]!,
    legacyConstraint: match[6]!,
    deleteAction: match[7]! as DeleteAction,
  }))
}

function signature(input: { childTable: string; childColumn: string; parentTable: string }) {
  return `${input.childTable}.tenant_id,${input.childColumn}->${input.parentTable}.tenant_id,id`
}

function hasIndexPrefix(table: TableConfig, columns: string[]) {
  return table.indexes.some((index) =>
    columns.every((column, position) => {
      const candidate = index.config.columns[position]
      return candidate && 'name' in candidate && candidate.name === column
    }),
  )
}

function foreignKeys(table: TableConfig): Map<string, DeleteAction> {
  return new Map(
    table.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      const parent = getTableConfig(reference.foreignTable).name
      return [
        `${table.name}.${reference.columns.map((column) => column.name).join(',')}->${parent}.${reference.foreignColumns.map((column) => column.name).join(',')}`,
        (foreignKey.onDelete ?? 'no action') as DeleteAction,
      ]
    }),
  )
}

describe('document relational integrity', () => {
  it('keeps the complete 23-edge physical manifest explicit and stable', () => {
    const relationships = manifest()
    expect(relationships).toHaveLength(23)
    expect(new Set(relationships.map(({ relationName }) => relationName)).size).toBe(23)
    expect(new Set(relationships.map(({ constraintName }) => constraintName)).size).toBe(23)
    expect(new Set(relationships.map(({ legacyConstraint }) => legacyConstraint)).size).toBe(23)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'cascade')).toHaveLength(9)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'no action')).toHaveLength(
      12,
    )
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'set null')).toHaveLength(2)

    const expected = [
      ...cascadeRelationships.map((relationship) => `${relationship}|cascade`),
      ...noActionRelationships.map((relationship) => `${relationship}|no action`),
      ...partialSetNullRelationships.map((relationship) => `${relationship}|set null`),
    ].sort()
    expect(
      relationships
        .map((relationship) => `${signature(relationship)}|${relationship.deleteAction}`)
        .sort(),
    ).toEqual(expected)
    for (const relationship of relationships) {
      expect(relationship.constraintName.length, relationship.constraintName).toBeLessThanOrEqual(
        63,
      )
    }
  })

  it('models every cascade/no-action relationship and exact parent key', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const relationship of [
      ...cascadeRelationships.map((value) => ({ value, action: 'cascade' as const })),
      ...noActionRelationships.map((value) => ({ value, action: 'no action' as const })),
    ]) {
      const [child, parent] = relationship.value.split('->')
      const [childTableName, childColumns] = child!.split('.')
      const [parentTableName, parentColumns] = parent!.split('.')
      const childTable = tables.get(childTableName!)
      if (retiredDocumentTables.has(childTableName!)) {
        expect(childTable, `${childTableName} must remain retired`).toBeUndefined()
        continue
      }
      if (!childTable) throw new Error(`Missing live document table ${childTableName}`)
      if (supersededDocumentRelationships.has(relationship.value)) {
        expect(foreignKeys(childTable).get(relationship.value), relationship.value).toBeUndefined()
        continue
      }
      expect(foreignKeys(childTable).get(relationship.value), relationship.value).toBe(
        relationship.action,
      )
      expect(hasIndexPrefix(childTable, childColumns!.split(',')), relationship.value).toBe(true)
      const uniqueKeys = tables
        .get(parentTableName!)!
        .indexes.filter((index) => index.config.unique)
        .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
      expect(uniqueKeys, parentTableName).toContainEqual(parentColumns!.split(','))
    }
  })

  it('preserves partial SET NULL without clearing tenant ownership', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const relationship of partialSetNullRelationships) {
      const [child] = relationship.split('->')
      const [tableName, columns] = child!.split('.')
      const businessColumn = columns!.split(',')[1]!
      const table = tables.get(tableName!)!
      expect(
        [...foreignKeys(table).keys()].some((key) =>
          key.startsWith(`${tableName}.${businessColumn}->`),
        ),
        relationship,
      ).toBe(false)
      expect(hasIndexPrefix(table, ['tenant_id', businessColumn]), relationship).toBe(true)
    }
    expect(migrationSql).toContain("WHEN 'set null' THEN format('SET NULL (%I)'")
  })

  it('preflights all tenants and validates before retiring legacy keys', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain('Document tenant/relation integrity preflight failed')
    const relaxed = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    const restored = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    expect(relaxed).toHaveLength(14)
    expect(restored).toEqual(relaxed)

    const errorAt = migrationSql.indexOf('Document tenant/relation integrity preflight failed')
    const restoreAt = migrationSql.indexOf('FORCE ROW LEVEL SECURITY', errorAt)
    const ddlAt = migrationSql.indexOf('CREATE UNIQUE INDEX')
    const addAt = migrationSql.indexOf('ADD CONSTRAINT %I FOREIGN KEY')
    const validateAt = migrationSql.indexOf('VALIDATE CONSTRAINT %I')
    const dropAt = migrationSql.indexOf('DROP CONSTRAINT %I')
    expect(restoreAt).toBeGreaterThan(errorAt)
    expect(ddlAt).toBeGreaterThan(restoreAt)
    expect(addAt).toBeGreaterThan(ddlAt)
    expect(migrationSql.slice(addAt, validateAt)).toContain('NOT VALID')
    expect(validateAt).toBeGreaterThan(addAt)
    expect(dropAt).toBeGreaterThan(validateAt)
  })
})
