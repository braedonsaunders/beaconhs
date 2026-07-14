import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0009_special_redwing.sql')

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

function relationshipSignature(input: {
  childTable: string
  childColumn: string
  parentTable: string
}): string {
  return `${input.childTable}.tenant_id,${input.childColumn}->${input.parentTable}.tenant_id,id`
}

const cascadeRelationships = [
  'equipment_checkouts.tenant_id,equipment_item_id->equipment_items.tenant_id,id',
  'equipment_inspection_criteria.tenant_id,inspection_type_id->equipment_inspection_types.tenant_id,id',
  'equipment_inspection_groups.tenant_id,inspection_type_id->equipment_inspection_types.tenant_id,id',
  'equipment_inspection_record_attachments.tenant_id,record_id->equipment_inspection_records.tenant_id,id',
  'equipment_inspection_record_criteria.tenant_id,record_id->equipment_inspection_records.tenant_id,id',
  'equipment_inspection_records.tenant_id,equipment_item_id->equipment_items.tenant_id,id',
  'equipment_inspection_schedules.tenant_id,equipment_item_id->equipment_items.tenant_id,id',
  'equipment_location_history.tenant_id,item_id->equipment_items.tenant_id,id',
  'equipment_log_entries.tenant_id,equipment_item_id->equipment_items.tenant_id,id',
  'equipment_reminders.tenant_id,equipment_item_id->equipment_items.tenant_id,id',
  'equipment_work_orders.tenant_id,item_id->equipment_items.tenant_id,id',
  'truck_log_entries.tenant_id,equipment_item_id->equipment_items.tenant_id,id',
] as const

const noActionRelationships = [
  'equipment_checkouts.tenant_id,checked_in_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_checkouts.tenant_id,checked_out_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_checkouts.tenant_id,destination_org_unit_id->org_units.tenant_id,id',
  'equipment_checkouts.tenant_id,holder_person_id->people.tenant_id,id',
  'equipment_inspection_record_criteria.tenant_id,answered_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_inspection_records.tenant_id,closed_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_inspection_records.tenant_id,inspector_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_inspection_records.tenant_id,site_org_unit_id->org_units.tenant_id,id',
  'equipment_inspection_records.tenant_id,submitted_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_inspection_records.tenant_id,supervisor_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_inspection_schedules.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_items.tenant_id,current_holder_person_id->people.tenant_id,id',
  'equipment_items.tenant_id,current_site_org_unit_id->org_units.tenant_id,id',
  'equipment_items.tenant_id,last_seen_holder_person_id->people.tenant_id,id',
  'equipment_items.tenant_id,last_seen_site_org_unit_id->org_units.tenant_id,id',
  'equipment_items.tenant_id,type_id->equipment_types.tenant_id,id',
  'equipment_location_history.tenant_id,holder_person_id->people.tenant_id,id',
  'equipment_location_history.tenant_id,recorded_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_location_history.tenant_id,site_org_unit_id->org_units.tenant_id,id',
  'equipment_log_entries.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_log_entries.tenant_id,person_person_id->people.tenant_id,id',
  'equipment_log_entries.tenant_id,site_org_unit_id->org_units.tenant_id,id',
  'equipment_reminders.tenant_id,completed_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_reminders.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_work_orders.tenant_id,assigned_to_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_work_orders.tenant_id,opened_by_tenant_user_id->tenant_users.tenant_id,id',
  'equipment_work_orders.tenant_id,reported_by_person_id->people.tenant_id,id',
  'truck_log_entries.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
  'truck_log_entries.tenant_id,driver_person_id->people.tenant_id,id',
  'truck_log_entries.tenant_id,site_org_unit_id->org_units.tenant_id,id',
] as const

const partialSetNullRelationships = [
  'equipment_inspection_criteria.tenant_id,group_id->equipment_inspection_groups.tenant_id,id',
  'equipment_inspection_record_criteria.tenant_id,work_order_id->equipment_work_orders.tenant_id,id',
  'equipment_inspection_records.tenant_id,inspection_type_id->equipment_inspection_types.tenant_id,id',
  'equipment_inspection_records.tenant_id,inspector_person_id->people.tenant_id,id',
  'equipment_inspection_records.tenant_id,work_order_id->equipment_work_orders.tenant_id,id',
  'equipment_inspection_schedules.tenant_id,inspection_type_id->equipment_inspection_types.tenant_id,id',
  'equipment_inspection_types.tenant_id,applies_to_type_id->equipment_types.tenant_id,id',
  'equipment_items.tenant_id,category_id->equipment_categories.tenant_id,id',
  'equipment_items.tenant_id,pre_use_inspection_type_id->equipment_inspection_types.tenant_id,id',
  'equipment_reminders.tenant_id,assigned_to_person_id->people.tenant_id,id',
  'equipment_station_settings.tenant_id,default_check_in_org_unit_id->org_units.tenant_id,id',
  'equipment_types.tenant_id,category_id->equipment_categories.tenant_id,id',
  'truck_log_entries.tenant_id,source_connection_id->sync_connections.tenant_id,id',
] as const

const schemaRelationships = [
  ...cascadeRelationships.map((signature) => ({ signature, onDelete: 'cascade' as const })),
  ...noActionRelationships.map((signature) => ({ signature, onDelete: 'no action' as const })),
]

function hasIndexPrefix(table: TableConfig, columns: string[]): boolean {
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
      const localColumns = reference.columns.map((column) => column.name).join(',')
      const parentColumns = reference.foreignColumns.map((column) => column.name).join(',')
      return [
        `${table.name}.${localColumns}->${parent}.${parentColumns}`,
        (foreignKey.onDelete ?? 'no action') as DeleteAction,
      ]
    }),
  )
}

describe('equipment relational integrity', () => {
  it('keeps the complete 55-edge physical manifest explicit and stable', () => {
    const relationships = manifestRelationships()
    expect(relationships).toHaveLength(55)
    expect(new Set(relationships.map(({ relationName }) => relationName)).size).toBe(55)
    expect(new Set(relationships.map(({ constraintName }) => constraintName)).size).toBe(55)
    expect(new Set(relationships.map(({ legacyConstraint }) => legacyConstraint)).size).toBe(55)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'cascade')).toHaveLength(12)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'no action')).toHaveLength(
      30,
    )
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'set null')).toHaveLength(13)

    const expected = [
      ...cascadeRelationships.map((signature) => `${signature}|cascade`),
      ...noActionRelationships.map((signature) => `${signature}|no action`),
      ...partialSetNullRelationships.map((signature) => `${signature}|set null`),
    ].sort()
    const actual = relationships
      .map((relationship) => `${relationshipSignature(relationship)}|${relationship.deleteAction}`)
      .sort()
    expect(actual).toEqual(expected)

    for (const relationship of relationships) {
      expect(relationship.constraintName.length, relationship.constraintName).toBeLessThanOrEqual(
        63,
      )
    }
  })

  it('models every cascade/no-action edge with a tenant-aware schema key and index', () => {
    const tablesByName = new Map(allTableConfigs().map((table) => [table.name, table]))

    for (const relationship of schemaRelationships) {
      const [child, parent] = relationship.signature.split('->')
      const [childTableName, childColumnList] = child!.split('.')
      const childTable = tablesByName.get(childTableName!)!
      expect(foreignKeys(childTable).get(relationship.signature), relationship.signature).toBe(
        relationship.onDelete,
      )
      expect(
        hasIndexPrefix(childTable, childColumnList!.split(',')),
        `${relationship.signature} child index`,
      ).toBe(true)
      expect(parent).toBeTruthy()
    }
  })

  it('backs every composite parent with an exact tenant/id unique key', () => {
    const tablesByName = new Map(allTableConfigs().map((table) => [table.name, table]))
    const parentTables = new Set(
      manifestRelationships().map((relationship) => relationship.parentTable),
    )

    for (const tableName of parentTables) {
      const uniqueKeys = tablesByName
        .get(tableName)!
        .indexes.filter((index) => index.config.unique)
        .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
      expect(uniqueKeys, tableName).toContainEqual(['tenant_id', 'id'])
    }
  })

  it('keeps partial SET NULL edges out of the lossy schema representation', () => {
    const tablesByName = new Map(allTableConfigs().map((table) => [table.name, table]))
    const manifest = manifestRelationships()

    for (const signature of partialSetNullRelationships) {
      const [child] = signature.split('->')
      const [tableName, columnList] = child!.split('.')
      const table = tablesByName.get(tableName!)!
      const column = columnList!.split(',')[1]!
      expect(
        [...foreignKeys(table).keys()].some((key) => key.startsWith(`${tableName}.${column}->`)),
        `${signature} must be physical SQL only`,
      ).toBe(false)
      expect(hasIndexPrefix(table, ['tenant_id', column]), `${signature} child index`).toBe(true)
      expect(
        manifest.some(
          (relationship) =>
            relationshipSignature(relationship) === signature &&
            relationship.deleteAction === 'set null',
        ),
        signature,
      ).toBe(true)
    }

    expect(migrationSql).toContain("WHEN 'set null' THEN format('SET NULL (%I)'")
  })

  it('fails closed under visible all-tenant preflight before durable DDL', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain('Equipment tenant/relation integrity preflight failed')
    expect(migrationSql).toContain('parent.%I IS NULL OR child.%I IS DISTINCT FROM parent.%I')

    const relaxedTables = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    const restoredTables = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    expect(relaxedTables).toHaveLength(21)
    expect(restoredTables).toEqual(relaxedTables)

    const lastRelaxAt = migrationSql.lastIndexOf('NO FORCE ROW LEVEL SECURITY')
    const preflightErrorAt = migrationSql.indexOf(
      'Equipment tenant/relation integrity preflight failed',
    )
    const firstRestoreAt = migrationSql.indexOf(
      'FORCE ROW LEVEL SECURITY',
      lastRelaxAt + 'NO FORCE ROW LEVEL SECURITY'.length,
    )
    const firstDurableDdlAt = migrationSql.indexOf('CREATE UNIQUE INDEX')
    const addAt = migrationSql.indexOf('ADD CONSTRAINT %I FOREIGN KEY')
    const validateAt = migrationSql.indexOf('VALIDATE CONSTRAINT %I')
    const dropAt = migrationSql.indexOf('DROP CONSTRAINT %I')

    expect(preflightErrorAt).toBeGreaterThan(lastRelaxAt)
    expect(firstRestoreAt).toBeGreaterThan(preflightErrorAt)
    expect(firstDurableDdlAt).toBeGreaterThan(firstRestoreAt)
    expect(addAt).toBeGreaterThan(firstDurableDdlAt)
    expect(migrationSql.slice(addAt, validateAt)).toContain('NOT VALID')
    expect(validateAt).toBeGreaterThan(addAt)
    expect(dropAt).toBeGreaterThan(validateAt)
  })
})
