import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'
import { readProductionCutoverSection } from './test/read-production-cutover-section'

const migrationSql = readProductionCutoverSection('0013_sour_spyke.sql')

type TableConfig = ReturnType<typeof getTableConfig>
type DeleteAction = 'cascade' | 'no action' | 'set null'

const cascadeRelationships = [
  'incident_attachments.tenant_id,incident_id->incidents.tenant_id,id',
  'incident_classifications.tenant_id,parent_id->incident_classifications.tenant_id,id',
  'incident_contributing_factors.tenant_id,incident_id->incidents.tenant_id,id',
  'incident_events.tenant_id,incident_id->incidents.tenant_id,id',
  'incident_injuries.tenant_id,incident_id->incidents.tenant_id,id',
  'incident_lost_time_events.tenant_id,incident_id->incidents.tenant_id,id',
  'incident_people.tenant_id,incident_id->incidents.tenant_id,id',
  'incident_preventative_steps.tenant_id,incident_id->incidents.tenant_id,id',
  'incident_root_cause_whys.tenant_id,incident_id->incidents.tenant_id,id',
] as const

const noActionRelationships = [
  'incident_injuries.tenant_id,person_id->people.tenant_id,id',
  'incident_lost_time_events.tenant_id,injury_id->incident_injuries.tenant_id,id',
  'incident_people.tenant_id,person_id->people.tenant_id,id',
  'incidents.tenant_id,assigned_investigator_tenant_user_id->tenant_users.tenant_id,id',
  'incidents.tenant_id,closed_by_tenant_user_id->tenant_users.tenant_id,id',
  'incidents.tenant_id,department_id->departments.tenant_id,id',
  'incidents.tenant_id,reported_by_tenant_user_id->tenant_users.tenant_id,id',
  'incidents.tenant_id,site_org_unit_id->org_units.tenant_id,id',
  'incidents.tenant_id,supervisor_person_id->people.tenant_id,id',
] as const

const partialSetNullRelationships = [
  'incident_classifications.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
  'incident_events.tenant_id,recorded_by_tenant_user_id->tenant_users.tenant_id,id',
  'incident_hours_periods.tenant_id,entered_by_tenant_user_id->tenant_users.tenant_id,id',
  'incident_hours_periods.tenant_id,site_org_unit_id->org_units.tenant_id,id',
  'incident_injuries.tenant_id,injury_type_id->incident_injury_types.tenant_id,id',
  'incident_injury_types.tenant_id,created_by_tenant_user_id->tenant_users.tenant_id,id',
  'incident_preventative_steps.tenant_id,owner_person_id->people.tenant_id,id',
  'incidents.tenant_id,classification_id->incident_classifications.tenant_id,id',
  'incidents.tenant_id,source_form_response_id->form_responses.tenant_id,id',
] as const

// The single injury_type_id edge remains in the immutable cutover-manifest
// assertion above, but the current greenfield schema replaces it with the
// canonical many-to-many assignment table.
const currentPartialSetNullRelationships = partialSetNullRelationships.filter(
  (relationship) =>
    relationship !==
    'incident_injuries.tenant_id,injury_type_id->incident_injury_types.tenant_id,id',
)

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
      /^\s+\('([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', (?:'([^']+)'|(NULL)), '(cascade|no action|set null)'\)[,;](?:-->.*)?$/gm,
    ),
  ].map((match) => ({
    relationName: match[1]!,
    childTable: match[2]!,
    childColumn: match[3]!,
    parentTable: match[4]!,
    constraintName: match[5]!,
    legacyConstraint: match[6] ?? null,
    deleteAction: match[8]! as DeleteAction,
  }))
}

function signature(input: { childTable: string; childColumn: string; parentTable: string }) {
  return `${input.childTable}.tenant_id,${input.childColumn}->${input.parentTable}.tenant_id,id`
}

function foreignKeys(table: TableConfig): Map<string, DeleteAction> {
  return new Map(
    table.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      return [
        `${table.name}.${reference.columns.map((column) => column.name).join(',')}->${getTableConfig(reference.foreignTable).name}.${reference.foreignColumns.map((column) => column.name).join(',')}`,
        (foreignKey.onDelete ?? 'no action') as DeleteAction,
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

describe('incident relational integrity', () => {
  it('keeps the complete 27-edge manifest explicit, including two formerly missing keys', () => {
    const relationships = manifest()
    expect(relationships).toHaveLength(27)
    expect(new Set(relationships.map(({ relationName }) => relationName)).size).toBe(27)
    expect(new Set(relationships.map(({ constraintName }) => constraintName)).size).toBe(27)
    expect(relationships.filter(({ legacyConstraint }) => legacyConstraint === null)).toHaveLength(
      2,
    )
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'cascade')).toHaveLength(9)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'no action')).toHaveLength(9)
    expect(relationships.filter(({ deleteAction }) => deleteAction === 'set null')).toHaveLength(9)

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

  it('models every cascade/no-action relationship and supporting key', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const relationship of [
      ...cascadeRelationships.map((value) => ({ value, action: 'cascade' as const })),
      ...noActionRelationships.map((value) => ({ value, action: 'no action' as const })),
    ]) {
      const [child, parent] = relationship.value.split('->')
      const [childTableName, childColumns] = child!.split('.')
      const [parentTableName, parentColumns] = parent!.split('.')
      expect(foreignKeys(tables.get(childTableName!)!).get(relationship.value)).toBe(
        relationship.action,
      )
      expect(hasIndexPrefix(tables.get(childTableName!)!, childColumns!.split(','))).toBe(true)
      const uniqueKeys = tables
        .get(parentTableName!)!
        .indexes.filter((index) => index.config.unique)
        .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
      expect(uniqueKeys, parentTableName).toContainEqual(parentColumns!.split(','))
    }
  })

  it('preserves partial SET NULL without clearing tenant ownership', () => {
    const tables = new Map(allTableConfigs().map((table) => [table.name, table]))
    for (const relationship of currentPartialSetNullRelationships) {
      const [child] = relationship.split('->')
      const [tableName, columns] = child!.split('.')
      const businessColumn = columns!.split(',')[1]!
      expect(
        [...foreignKeys(tables.get(tableName!)!).keys()].some((key) =>
          key.startsWith(`${tableName}.${businessColumn}->`),
        ),
        relationship,
      ).toBe(false)
      expect(hasIndexPrefix(tables.get(tableName!)!, ['tenant_id', businessColumn])).toBe(true)
    }
    expect(migrationSql).toContain("WHEN 'set null' THEN format('SET NULL (%I)'")
  })

  it('enforces one root-cause why per tenant, incident, and ordinal', () => {
    const table = allTableConfigs().find(
      (candidate) => candidate.name === 'incident_root_cause_whys',
    )!
    const index = table.indexes.find(
      (candidate) =>
        candidate.config.name === 'incident_root_cause_whys_tenant_incident_ordinal_ux',
    )
    expect(index?.config.unique).toBe(true)
    expect(index?.config.columns.map((column) => ('name' in column ? column.name : ''))).toEqual([
      'tenant_id',
      'incident_id',
      'ordinal',
    ])
    expect(migrationSql).toContain('incident_root_cause_whys.ordinal_uniqueness')
  })

  it('preflights every tenant and validates before retiring legacy keys', () => {
    expect(migrationSql).not.toContain('DISABLE ROW LEVEL SECURITY')
    expect(migrationSql).toContain('Incident tenant/relation integrity preflight failed')
    const relaxed = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" NO FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    const restored = [
      ...migrationSql.matchAll(/^ALTER TABLE "([^"]+)" FORCE ROW LEVEL SECURITY;.*$/gm),
    ].map((match) => match[1]!)
    expect(relaxed).toHaveLength(17)
    expect(restored).toEqual(relaxed)

    const errorAt = migrationSql.indexOf('Incident tenant/relation integrity preflight failed')
    const restoreAt = migrationSql.indexOf('FORCE ROW LEVEL SECURITY', errorAt)
    const addAt = migrationSql.indexOf('ADD CONSTRAINT %I FOREIGN KEY')
    const validateAt = migrationSql.indexOf('VALIDATE CONSTRAINT %I')
    const dropAt = migrationSql.indexOf('DROP CONSTRAINT %I')
    expect(restoreAt).toBeGreaterThan(errorAt)
    expect(addAt).toBeGreaterThan(restoreAt)
    expect(migrationSql.slice(addAt, validateAt)).toContain('NOT VALID')
    expect(validateAt).toBeGreaterThan(addAt)
    expect(dropAt).toBeGreaterThan(validateAt)
  })
})
