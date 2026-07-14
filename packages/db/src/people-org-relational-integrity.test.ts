import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  normalizeRelation,
} from 'drizzle-orm/relations'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0017_nosy_stone_men.sql')

type TableConfig = ReturnType<typeof getTableConfig>
type DeleteAction = 'cascade' | 'no action' | 'set null'

type ManifestRelationship = {
  relationName: string
  childTable: string
  childColumn: string
  parentTable: string
  constraintName: string
  legacyConstraint: string
  deleteAction: DeleteAction
}

const cascadeRelationships = [
  'customer_contacts.tenant_id,org_unit_id->org_units.tenant_id,id',
  'job_title_task_acknowledgments.tenant_id,person_id->people.tenant_id,id',
  'job_title_task_acknowledgments.tenant_id,task_id->job_title_tasks.tenant_id,id',
  'job_title_tasks.tenant_id,title_id->person_titles.tenant_id,id',
  'kiosk_scans.tenant_id,person_id->people.tenant_id,id',
  'org_units.tenant_id,parent_id->org_units.tenant_id,id',
  'people_assignments.tenant_id,org_unit_id->org_units.tenant_id,id',
  'people_assignments.tenant_id,person_id->people.tenant_id,id',
  'person_files.tenant_id,person_id->people.tenant_id,id',
  'person_group_memberships.tenant_id,group_id->person_groups.tenant_id,id',
  'person_group_memberships.tenant_id,person_id->people.tenant_id,id',
  'person_title_assignments.tenant_id,person_id->people.tenant_id,id',
  'person_title_assignments.tenant_id,title_id->person_titles.tenant_id,id',
] as const

const noActionRelationships = [
  'kiosk_scans.tenant_id,crew_id->crews.tenant_id,id',
  'kiosk_scans.tenant_id,site_org_unit_id->org_units.tenant_id,id',
  'people.tenant_id,crew_id->crews.tenant_id,id',
  'people.tenant_id,department_id->departments.tenant_id,id',
  'people.tenant_id,trade_id->trades.tenant_id,id',
] as const

const partialSetNullRelationships = [
  'people.tenant_id,manager_person_id->people.tenant_id,id',
] as const

const domainTables = new Set([
  'customer_contacts',
  'job_title_task_acknowledgments',
  'job_title_tasks',
  'kiosk_scans',
  'org_units',
  'people',
  'people_assignments',
  'person_files',
  'person_group_memberships',
  'person_title_assignments',
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

function manifestRelationships(): ManifestRelationship[] {
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

function foreignKeys(table: TableConfig): Map<string, Exclude<DeleteAction, 'set null'>> {
  return new Map(
    table.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      return [
        `${table.name}.${reference.columns.map((column) => column.name).join(',')}->${getTableConfig(reference.foreignTable).name}.${reference.foreignColumns.map((column) => column.name).join(',')}`,
        (foreignKey.onDelete ?? 'no action') as Exclude<DeleteAction, 'set null'>,
      ]
    }),
  )
}

function hasIndexPrefix(table: TableConfig, columns: string[]) {
  return table.indexes.some((index) =>
    columns.every((column, position) => {
      const candidate = index.config.columns[position]
      return candidate && 'name' in candidate && candidate.name === column
    }),
  )
}

describe('people and org relational integrity', () => {
  it('keeps the complete 19-edge physical manifest explicit and stable', () => {
    const relationships = manifestRelationships()
    expect(relationships).toHaveLength(19)
    expect(new Set(relationships.map(({ relationName }) => relationName)).size).toBe(19)
    expect(new Set(relationships.map(({ constraintName }) => constraintName)).size).toBe(19)
    expect(new Set(relationships.map(({ legacyConstraint }) => legacyConstraint)).size).toBe(19)
    expect(
      new Set(relationships.map(({ legacyConstraint }) => legacyConstraint.slice(0, 63))).size,
    ).toBe(19)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'cascade')).toHaveLength(13)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'no action')).toHaveLength(5)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'set null')).toHaveLength(1)

    const expected = [
      ...cascadeRelationships.map((value) => `${value}|cascade`),
      ...noActionRelationships.map((value) => `${value}|no action`),
      ...partialSetNullRelationships.map((value) => `${value}|set null`),
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

  it('models every relationship with a tenant-aware schema key and child index', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const relationship of manifestRelationships()) {
      const relationshipSignature = signature(relationship)
      const child = tables.get(relationship.childTable)!
      const schemaDeleteAction =
        relationship.deleteAction === 'set null' ? 'no action' : relationship.deleteAction
      expect(foreignKeys(child).get(relationshipSignature), relationshipSignature).toBe(
        schemaDeleteAction,
      )
      expect(
        hasIndexPrefix(child, ['tenant_id', relationship.childColumn]),
        `${relationshipSignature} child index`,
      ).toBe(true)
    }
  })

  it('backs every composite parent with an exact tenant/id unique key', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const tableName of new Set(
      manifestRelationships().map((relationship) => relationship.parentTable),
    )) {
      const uniqueKeys = tables
        .get(tableName)!
        .indexes.filter((index) => index.config.unique)
        .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
      expect(uniqueKeys, tableName).toContainEqual(['tenant_id', 'id'])
    }
  })

  it('keeps all 19 ORM relation joins tenant-qualified', () => {
    const { tables, tableNamesMap } = extractTablesRelationalConfig(
      schema,
      createTableRelationsHelpers,
    )
    const expected = [
      ['customerContacts', 'orgUnit', 'org_units', ['tenant_id', 'org_unit_id']],
      ['jobTitleTaskAcknowledgments', 'person', 'people', ['tenant_id', 'person_id']],
      ['jobTitleTaskAcknowledgments', 'task', 'job_title_tasks', ['tenant_id', 'task_id']],
      ['jobTitleTasks', 'title', 'person_titles', ['tenant_id', 'title_id']],
      ['kioskScans', 'crew', 'crews', ['tenant_id', 'crew_id']],
      ['kioskScans', 'person', 'people', ['tenant_id', 'person_id']],
      ['kioskScans', 'site', 'org_units', ['tenant_id', 'site_org_unit_id']],
      ['orgUnits', 'parent', 'org_units', ['tenant_id', 'parent_id']],
      ['people', 'crew', 'crews', ['tenant_id', 'crew_id']],
      ['people', 'department', 'departments', ['tenant_id', 'department_id']],
      ['people', 'manager', 'people', ['tenant_id', 'manager_person_id']],
      ['people', 'trade', 'trades', ['tenant_id', 'trade_id']],
      ['peopleAssignments', 'orgUnit', 'org_units', ['tenant_id', 'org_unit_id']],
      ['peopleAssignments', 'person', 'people', ['tenant_id', 'person_id']],
      ['personFiles', 'person', 'people', ['tenant_id', 'person_id']],
      ['personGroupMemberships', 'group', 'person_groups', ['tenant_id', 'group_id']],
      ['personGroupMemberships', 'person', 'people', ['tenant_id', 'person_id']],
      ['personTitleAssignments', 'person', 'people', ['tenant_id', 'person_id']],
      ['personTitleAssignments', 'title', 'person_titles', ['tenant_id', 'title_id']],
    ] as const

    for (const [tableName, relationName, parentName, childColumns] of expected) {
      const table = tables[tableName]
      expect(table, tableName).toBeDefined()
      const relation = table!.relations[relationName]
      expect(relation, `${tableName}.${relationName}`).toBeDefined()
      expect(relation!.referencedTableName).toBe(parentName)
      const normalized = normalizeRelation(tables, tableNamesMap, relation!)
      expect(normalized.fields.map((column) => column.name)).toEqual(childColumns)
      expect(normalized.references.map((column) => column.name)).toEqual(['tenant_id', 'id'])
    }
  })

  it('leaves no single-column FK in the converted people/org domain', () => {
    const tables = allTableConfigs()
    const tenantTables = new Set(
      tables
        .filter((table) => table.columns.some((column) => column.name === 'tenant_id'))
        .map((table) => table.name),
    )
    const residual: string[] = []

    for (const table of tables.filter((candidate) => domainTables.has(candidate.name))) {
      for (const foreignKey of table.foreignKeys) {
        const reference = foreignKey.reference()
        const parentName = getTableConfig(reference.foreignTable).name
        if (
          tenantTables.has(parentName) &&
          !reference.columns.some((column) => column.name === 'tenant_id')
        ) {
          residual.push(
            `${table.name}.${reference.columns.map((column) => column.name).join(',')}->${parentName}`,
          )
        }
      }
    }
    expect(residual).toEqual([])
  })

  it('removes the proven orphan crew foreman field without silent data loss', () => {
    const crewColumns = getTableConfig(schema.crews).columns.map((column) => column.name)
    expect(crewColumns).not.toContain('foreman_person_id')
    expect(migrationSql).toContain('WHERE "foreman_person_id" IS NOT NULL')
    expect(migrationSql).toContain('crews.foreman_person_id(unused non-null values)')
    const preflightAt = migrationSql.indexOf('WHERE "foreman_person_id" IS NOT NULL')
    const dropAt = migrationSql.indexOf('DROP COLUMN "foreman_person_id"')
    expect(dropAt).toBeGreaterThan(preflightAt)
  })

  it('preserves manager SET NULL without clearing tenant ownership', () => {
    expect(migrationSql).toContain("WHEN 'set null' THEN format('SET NULL (%I)'")
    expect(migrationSql).toContain(`SET NULL (%I)', relationship."child_column"`)
    expect(partialSetNullRelationships[0].split(',')[1]!.split('->')[0]).toBe('manager_person_id')
  })

  it('preflights every tenant and validates replacements before retiring legacy keys', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain('People/org tenant/relation integrity preflight failed')
    expect(migrationSql).toContain('parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I')

    const relaxed = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    const restored = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    expect(relaxed).toHaveLength(15)
    expect(restored).toEqual(relaxed)

    const lastRelaxAt = migrationSql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const errorAt = migrationSql.indexOf('People/org tenant/relation integrity preflight failed')
    const firstRestoreAt = migrationSql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const parentKeysAt = migrationSql.indexOf('CREATE UNIQUE INDEX')
    const addAt = migrationSql.indexOf('ADD CONSTRAINT %I FOREIGN KEY')
    const validateAt = migrationSql.indexOf('VALIDATE CONSTRAINT %I')
    const legacyDropAt = migrationSql.indexOf('left(relationship."legacy_constraint", 63)')
    const orphanDropAt = migrationSql.indexOf('DROP COLUMN "foreman_person_id"')
    expect(errorAt).toBeGreaterThan(lastRelaxAt)
    expect(firstRestoreAt).toBeGreaterThan(errorAt)
    expect(parentKeysAt).toBeGreaterThan(firstRestoreAt)
    expect(addAt).toBeGreaterThan(parentKeysAt)
    expect(migrationSql.slice(addAt, validateAt)).toContain('NOT VALID')
    expect(validateAt).toBeGreaterThan(addAt)
    expect(legacyDropAt).toBeGreaterThan(validateAt)
    expect(orphanDropAt).toBeGreaterThan(legacyDropAt)
  })
})
