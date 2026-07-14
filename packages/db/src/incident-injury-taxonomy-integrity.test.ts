import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { TENANT_SCOPED_TABLES } from './rls'
import { incidentInjuries, incidentInjuryTypeAssignments, incidentInjuryTypes } from './schema'

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name)
}

function foreignKeyMap(table: Parameters<typeof getTableConfig>[0]) {
  const config = getTableConfig(table)
  return new Map(
    config.foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference()
      return [
        `${reference.columns.map((column) => column.name).join(',')}->${getTableConfig(reference.foreignTable).name}.${reference.foreignColumns.map((column) => column.name).join(',')}`,
        foreignKey.onDelete ?? 'no action',
      ]
    }),
  )
}

describe('incident injury taxonomy integrity', () => {
  it('has one canonical tenant-safe many-to-many type store', () => {
    expect(columnNames(incidentInjuries)).toContain('injury_result')
    expect(columnNames(incidentInjuries)).not.toContain('injury_types')
    expect(columnNames(incidentInjuries)).not.toContain('injury_type_id')

    const assignments = getTableConfig(incidentInjuryTypeAssignments)
    expect(assignments.name).toBe('incident_injury_type_assignments')
    expect(assignments.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['id', 'tenant_id', 'injury_id', 'injury_type_id']),
    )
    const foreignKeys = foreignKeyMap(incidentInjuryTypeAssignments)
    expect(foreignKeys.get('tenant_id,injury_id->incident_injuries.tenant_id,id')).toBe('cascade')
    expect(foreignKeys.get('tenant_id,injury_type_id->incident_injury_types.tenant_id,id')).toBe(
      'no action',
    )

    const uniqueAssignment = assignments.indexes.find(
      (index) => index.config.name === 'incident_injury_type_assignments_injury_type_ux',
    )
    expect(uniqueAssignment?.config.unique).toBe(true)
    expect(
      uniqueAssignment?.config.columns.map((column) => ('name' in column ? column.name : '')),
    ).toEqual(['tenant_id', 'injury_id', 'injury_type_id'])
    expect(TENANT_SCOPED_TABLES).toContain('incident_injury_type_assignments')
  })

  it('keeps composite parent keys available for both assignment foreign keys', () => {
    for (const table of [incidentInjuries, incidentInjuryTypes]) {
      const tenantIdKey = getTableConfig(table).indexes.find(
        (index) =>
          index.config.unique &&
          index.config.columns.map((column) => ('name' in column ? column.name : '')).join(',') ===
            'tenant_id,id',
      )
      expect(tenantIdKey?.config.unique).toBe(true)
    }
  })
})
