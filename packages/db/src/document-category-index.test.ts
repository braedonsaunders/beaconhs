import { describe, expect, it } from 'vitest'
import { SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { documentCategories } from './schema'

function renderSql(value: SQL): string {
  return new PgDialect().sqlToQuery(value).sql.replaceAll('"', '').toLowerCase()
}

describe('document category sibling-name identity', () => {
  const indexes = getTableConfig(documentCategories).indexes
  const activeNameIndex = indexes.find(
    (index) => index.config.name === 'document_categories_active_parent_name_ux',
  )

  it('replaces the legacy tenant-wide name constraint', () => {
    expect(
      indexes.some((index) => index.config.name === 'document_categories_tenant_name_ux'),
    ).toBe(false)
    expect(activeNameIndex?.config.unique).toBe(true)
  })

  it('scopes names by parent while normalizing top-level, case, and whitespace', () => {
    expect(activeNameIndex).toBeDefined()
    const [tenant, parent, name] = activeNameIndex!.config.columns
    expect('name' in tenant! ? tenant.name : null).toBe('tenant_id')
    expect(renderSql(parent as SQL)).toMatch(/coalesce\(.+parent_id::text, ''\)/)
    expect(renderSql(name as SQL)).toMatch(/lower\(btrim\(.+name\)\)/)
  })

  it('only reserves sibling names while the category is active', () => {
    expect(renderSql(activeNameIndex!.config.where!)).toContain('deleted_at is null')
  })
})
