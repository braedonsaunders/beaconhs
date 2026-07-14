import { SQL } from 'drizzle-orm'
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { documents } from './schema'

function renderSql(value: SQL): string {
  return new PgDialect().sqlToQuery(value).sql.replaceAll('"', '').toLowerCase()
}

describe('document key integrity', () => {
  const indexes = getTableConfig(documents).indexes
  const keyIndex = indexes.find((index) => index.config.name === 'documents_tenant_key_live_ux')

  it('reserves a case-insensitive key once per tenant for live documents', () => {
    expect(keyIndex?.config.unique).toBe(true)
    const [tenant, key] = keyIndex!.config.columns
    expect('name' in tenant! ? tenant.name : null).toBe('tenant_id')
    expect(renderSql(key as SQL)).toMatch(/lower\(.+key\)/)
    expect(renderSql(keyIndex!.config.where!)).toContain('deleted_at is null')
  })

  it('removes the weaker duplicate non-unique key index', () => {
    expect(indexes.some((index) => index.config.name === 'documents_key_idx')).toBe(false)
  })
})
