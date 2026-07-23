import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { parameterizedSql } from './client'

describe('parameterizedSql', () => {
  it('keeps compiler values as driver parameters, including repeated placeholders', () => {
    const built = new PgDialect().sqlToQuery(
      parameterizedSql(
        'select * from records where tenant_id = $1 and status = $2 or owner_id = $1',
        ['tenant-1', 'open'],
      ),
    )
    expect(built.sql).toBe(
      'select * from records where tenant_id = $1 and status = $2 or owner_id = $3',
    )
    expect(built.params).toEqual(['tenant-1', 'open', 'tenant-1'])
  })

  it('fails closed when a placeholder has no value', () => {
    expect(() => parameterizedSql('select $2', ['only-one'])).toThrow(
      'SQL parameter $2 has no bound value',
    )
  })
})
