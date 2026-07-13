import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { runCustomQuery } from './custom-query'
import { runReport } from './run'
import type { ReportEntity } from './entities'

const ENTITY: ReportEntity = {
  key: 'items',
  label: 'Items',
  category: 'Test',
  description: '',
  table: 'items',
  softDelete: true,
  columns: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'enum' },
    { key: 'amount', label: 'Amount', kind: 'number' },
  ],
}

function capturingDatabase() {
  const queries: SQL[] = []
  const database = {
    execute: async (query: SQL) => {
      queries.push(query)
      return []
    },
  } as unknown as Database
  return { database, queries }
}

describe('custom report query boundary', () => {
  it('uses only the authorized entity map and never executes an unknown source', async () => {
    const { database, queries } = capturingDatabase()
    await expect(
      runCustomQuery(
        database,
        { entity: 'hidden_items', mode: 'rows', columns: ['name'] },
        { entityMap: { items: ENTITY } },
      ),
    ).rejects.toThrow(/unknown entity/i)
    expect(queries).toHaveLength(0)
  })

  it('parameterizes nested filter values and applies the soft-delete predicate', async () => {
    const { database, queries } = capturingDatabase()
    const hostileValue = `%'; drop table items; --`

    await runCustomQuery(
      database,
      {
        entity: 'items',
        mode: 'rows',
        columns: ['name', 'amount'],
        filters: {
          combinator: 'and',
          rules: [
            { field: 'name', op: 'contains', value: hostileValue },
            {
              combinator: 'or',
              rules: [
                { field: 'status', op: 'eq', value: 'open' },
                { field: 'amount', op: 'gte', value: 10 },
              ],
            },
          ],
        },
      },
      { entityMap: { items: ENTITY } },
    )

    expect(queries).toHaveLength(1)
    const compiled = new PgDialect().sqlToQuery(queries[0]!)
    expect(compiled.sql).toContain('"items"."deleted_at" IS NULL')
    expect(compiled.sql).not.toContain(hostileValue)
    expect(compiled.params).toContain(`%${hostileValue}%`)
    expect(compiled.params).toContain('open')
    expect(compiled.params).toContain(10)
  })

  it('fails closed when the report dispatcher is missing an authorized map', async () => {
    const { database, queries } = capturingDatabase()
    await expect(
      runReport(database, {
        queryKind: 'custom_query',
        filters: {},
        range: { from: new Date(0), to: new Date(), label: 'test' },
        customQuery: { entity: 'items', mode: 'rows', columns: ['name'] },
      }),
    ).rejects.toThrow(/authorized entity map/i)
    expect(queries).toHaveLength(0)
  })
})
