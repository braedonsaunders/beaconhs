import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  normalizeRelation,
} from 'drizzle-orm/relations'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0016_awesome_saracen.sql')

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
  'inspection_bank_criteria.tenant_id,bank_id->inspection_banks.tenant_id,id',
  'inspection_record_attachments.tenant_id,record_id->inspection_records.tenant_id,id',
  'inspection_record_criteria.tenant_id,record_id->inspection_records.tenant_id,id',
  'inspection_type_criteria.tenant_id,type_id->inspection_types.tenant_id,id',
  'inspection_type_groups.tenant_id,type_id->inspection_types.tenant_id,id',
] as const

const noActionRelationships = [
  'inspection_record_criteria.tenant_id,answered_by_tenant_user_id->tenant_users.tenant_id,id',
  'inspection_records.tenant_id,type_id->inspection_types.tenant_id,id',
  'inspection_records.tenant_id,site_org_unit_id->org_units.tenant_id,id',
  'inspection_records.tenant_id,inspector_tenant_user_id->tenant_users.tenant_id,id',
  'inspection_records.tenant_id,supervisor_tenant_user_id->tenant_users.tenant_id,id',
  'inspection_records.tenant_id,customer_org_unit_id->org_units.tenant_id,id',
  'inspection_records.tenant_id,customer_contact_person_id->people.tenant_id,id',
  'inspection_records.tenant_id,submitted_by_tenant_user_id->tenant_users.tenant_id,id',
  'inspection_records.tenant_id,closed_by_tenant_user_id->tenant_users.tenant_id,id',
] as const

const partialSetNullRelationships = [
  'inspection_record_criteria.tenant_id,assigned_to_person_id->people.tenant_id,id',
  'inspection_record_criteria.tenant_id,assigned_to_tenant_user_id->tenant_users.tenant_id,id',
  'inspection_record_criteria.tenant_id,corrective_action_id->corrective_actions.tenant_id,id',
  'inspection_type_criteria.tenant_id,group_id->inspection_type_groups.tenant_id,id',
] as const

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
  return (
    [
      ...migrationSql.matchAll(
        /^\s+\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', '(cascade|no action|set null)'\)[,;](?:-->.*)?$/gm,
      ),
    ]
      .map((match) => ({
        relationName: match[1]!,
        childTable: match[2]!,
        childColumn: match[3]!,
        parentTable: match[4]!,
        constraintName: match[5]!,
        legacyConstraint: match[6]!,
        deleteAction: match[7]! as DeleteAction,
      }))
      // Migration 0016 predates the unified compliance cutover. Its one legacy
      // assignment edge is intentionally absent from the current schema.
      .filter(({ childTable }) => childTable !== 'inspection_assignments')
  )
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

describe('inspection relational integrity', () => {
  it('physically enforces closed-record locking and unique record photos', () => {
    const records = getTableConfig(schema.inspectionRecords)
    const attachments = getTableConfig(schema.inspectionRecordAttachments)
    expect(records.checks.map((check) => check.name)).toContain(
      'inspection_records_closed_locked_ck',
    )
    expect(
      attachments.indexes
        .filter((index) => index.config.unique)
        .map((index) =>
          index.config.columns.map((column) => ('name' in column ? column.name : '')),
        ),
    ).toContainEqual(['tenant_id', 'record_id', 'attachment_id'])
    expect(attachments.indexes.map((index) => index.config.name)).not.toContain(
      'inspection_record_attachments_record_idx',
    )
    expect(attachments.indexes.map((index) => index.config.name)).not.toContain(
      'inspection_record_attachments_tenant_idx',
    )
  })

  it('keeps the complete 18-edge current physical manifest explicit and stable', () => {
    const relationships = manifestRelationships()
    expect(relationships).toHaveLength(18)
    expect(new Set(relationships.map(({ relationName }) => relationName)).size).toBe(18)
    expect(new Set(relationships.map(({ constraintName }) => constraintName)).size).toBe(18)
    expect(new Set(relationships.map(({ legacyConstraint }) => legacyConstraint)).size).toBe(18)
    expect(
      new Set(relationships.map(({ legacyConstraint }) => legacyConstraint.slice(0, 63))).size,
    ).toBe(18)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'cascade')).toHaveLength(5)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'no action')).toHaveLength(9)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'set null')).toHaveLength(4)

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

  it('keeps ORM relation joins tenant-qualified with the physical keys', () => {
    const { tables, tableNamesMap } = extractTablesRelationalConfig(
      schema,
      createTableRelationsHelpers,
    )
    const expected = [
      ['inspectionBankCriteria', 'bank', 'inspection_banks', ['tenant_id', 'bank_id']],
      ['inspectionRecordAttachments', 'record', 'inspection_records', ['tenant_id', 'record_id']],
      ['inspectionRecordCriteria', 'record', 'inspection_records', ['tenant_id', 'record_id']],
      [
        'inspectionRecordCriteria',
        'correctiveAction',
        'corrective_actions',
        ['tenant_id', 'corrective_action_id'],
      ],
      [
        'inspectionRecordCriteria',
        'assignedToPerson',
        'people',
        ['tenant_id', 'assigned_to_person_id'],
      ],
      [
        'inspectionRecordCriteria',
        'assignedToTenantUser',
        'tenant_users',
        ['tenant_id', 'assigned_to_tenant_user_id'],
      ],
      ['inspectionRecords', 'type', 'inspection_types', ['tenant_id', 'type_id']],
      ['inspectionRecords', 'site', 'org_units', ['tenant_id', 'site_org_unit_id']],
      ['inspectionRecords', 'inspector', 'tenant_users', ['tenant_id', 'inspector_tenant_user_id']],
      ['inspectionTypeCriteria', 'type', 'inspection_types', ['tenant_id', 'type_id']],
      ['inspectionTypeCriteria', 'group', 'inspection_type_groups', ['tenant_id', 'group_id']],
      ['inspectionTypeGroups', 'type', 'inspection_types', ['tenant_id', 'type_id']],
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

  it('leaves no single-column inspection FK to another tenant-owned table', () => {
    const tables = allTableConfigs()
    const tenantTables = new Set(
      tables
        .filter((table) => table.columns.some((column) => column.name === 'tenant_id'))
        .map((table) => table.name),
    )
    const residual: string[] = []

    for (const table of tables.filter((candidate) => candidate.name.startsWith('inspection_'))) {
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

  it('preserves partial SET NULL without clearing tenant ownership', () => {
    expect(migrationSql).toContain("WHEN 'set null' THEN format('SET NULL (%I)'")
    for (const relationship of partialSetNullRelationships) {
      const businessColumn = relationship.split('->')[0]!.split('.')[1]!.split(',')[1]!
      expect(migrationSql).toContain(`SET NULL (%I)', relationship."child_column"`)
      expect(businessColumn).not.toBe('tenant_id')
    }
  })

  it('preflights every tenant and validates replacements before retiring legacy keys', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain('Inspection tenant/relation integrity preflight failed')
    expect(migrationSql).toContain('parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I')

    const relaxed = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    const restored = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    expect(relaxed).toHaveLength(13)
    expect(restored).toEqual(relaxed)

    const lastRelaxAt = migrationSql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const errorAt = migrationSql.indexOf('Inspection tenant/relation integrity preflight failed')
    const firstRestoreAt = migrationSql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const parentKeysAt = migrationSql.indexOf('CREATE UNIQUE INDEX')
    const addAt = migrationSql.indexOf('ADD CONSTRAINT %I FOREIGN KEY')
    const validateAt = migrationSql.indexOf('VALIDATE CONSTRAINT %I')
    const legacyDropAt = migrationSql.indexOf('left(relationship."legacy_constraint", 63)')
    expect(errorAt).toBeGreaterThan(lastRelaxAt)
    expect(firstRestoreAt).toBeGreaterThan(errorAt)
    expect(parentKeysAt).toBeGreaterThan(firstRestoreAt)
    expect(addAt).toBeGreaterThan(parentKeysAt)
    expect(migrationSql.slice(addAt, validateAt)).toContain('NOT VALID')
    expect(validateAt).toBeGreaterThan(addAt)
    expect(legacyDropAt).toBeGreaterThan(validateAt)
  })
})
