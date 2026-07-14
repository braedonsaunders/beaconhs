import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { customFieldDefinitions } from './schema'

describe('custom-field definition integrity', () => {
  const config = getTableConfig(customFieldDefinitions)

  it('physically enforces canonical keys and subtype-capable entity kinds', () => {
    expect(config.checks.map((check) => check.name).sort()).toEqual([
      'custom_field_definitions_key_format_ck',
      'custom_field_definitions_subtype_kind_ck',
    ])
  })

  it('keeps one definition key per tenant and entity kind', () => {
    const uniqueKeys = config.indexes
      .filter((index) => index.config.unique)
      .map((index) => index.config.columns.map((column) => ('name' in column ? column.name : '')))
    expect(uniqueKeys).toContainEqual(['tenant_id', 'entity_kind', 'key'])
  })
})
