import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  createTableRelationsHelpers,
  extractTablesRelationalConfig,
  normalizeRelation,
} from 'drizzle-orm/relations'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'

describe('corrective action source-response integrity', () => {
  it('tenant-qualifies the physical source response key and supporting index', () => {
    const config = getTableConfig(schema.correctiveActions)
    const foreignKey = config.foreignKeys.find(
      (candidate) => candidate.getName() === 'corrective_actions_tenant_source_response_fk',
    )

    expect(foreignKey).toBeDefined()
    const reference = foreignKey!.reference()
    expect(reference.columns.map((column) => column.name)).toEqual([
      'tenant_id',
      'source_form_response_id',
    ])
    expect(getTableConfig(reference.foreignTable).name).toBe('form_responses')
    expect(reference.foreignColumns.map((column) => column.name)).toEqual(['tenant_id', 'id'])
    expect(foreignKey!.onDelete ?? 'no action').toBe('no action')

    const index = config.indexes.find(
      (candidate) => candidate.config.name === 'corrective_actions_source_response_idx',
    )
    expect(index).toBeDefined()
    expect(index!.config.columns.map((column) => ('name' in column ? column.name : ''))).toEqual([
      'tenant_id',
      'source_form_response_id',
    ])
  })

  it('keeps ORM relation joins tenant-qualified', () => {
    const { tables, tableNamesMap } = extractTablesRelationalConfig(
      schema,
      createTableRelationsHelpers,
    )
    const relation = tables.correctiveActions?.relations.sourceResponse

    expect(relation).toBeDefined()
    expect(relation!.referencedTableName).toBe('form_responses')
    const normalized = normalizeRelation(tables, tableNamesMap, relation!)
    expect(normalized.fields.map((column) => column.name)).toEqual([
      'tenant_id',
      'source_form_response_id',
    ])
    expect(normalized.references.map((column) => column.name)).toEqual(['tenant_id', 'id'])
  })
})
