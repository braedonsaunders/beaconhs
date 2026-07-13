import { describe, expect, it } from 'vitest'
import type { ReportEntity } from '@beaconhs/reports'
import { validateCustomQuery } from './validate'

const ENTITY: ReportEntity = {
  key: 'items',
  label: 'Items',
  category: 'Test',
  description: '',
  table: 'items',
  columns: [
    { key: 'name', label: 'Name', kind: 'text' },
    { key: 'status', label: 'Status', kind: 'enum' },
  ],
}

describe('validateCustomQuery', () => {
  it('accepts and sanitizes the canonical nested filter tree', () => {
    const query = validateCustomQuery(
      {
        entity: 'items',
        mode: 'rows',
        columns: ['name'],
        filters: {
          combinator: 'or',
          rules: [
            { field: 'status', op: 'eq', value: 'open' },
            { field: 'name', op: 'contains', value: 'pump' },
          ],
        },
      },
      { items: ENTITY },
    )

    expect(query.filters).toEqual({
      combinator: 'or',
      rules: [
        { field: 'status', op: 'eq', value: 'open' },
        { field: 'name', op: 'contains', value: 'pump' },
      ],
    })
  })

  it('rejects the retired flat filter shape instead of silently broadening a query', () => {
    expect(() =>
      validateCustomQuery(
        {
          entity: 'items',
          mode: 'rows',
          columns: ['name'],
          filters: [{ column: 'status', op: 'eq', value: 'open' }],
        },
        { items: ENTITY },
      ),
    ).toThrow(/filter group rules/i)
  })

  it('rejects unknown filter fields and operators', () => {
    expect(() =>
      validateCustomQuery(
        {
          entity: 'items',
          mode: 'rows',
          columns: ['name'],
          filters: { combinator: 'and', rules: [{ field: 'secret', op: 'eq', value: 'x' }] },
        },
        { items: ENTITY },
      ),
    ).toThrow(/invalid filter field/i)

    expect(() =>
      validateCustomQuery(
        {
          entity: 'items',
          mode: 'rows',
          columns: ['name'],
          filters: { combinator: 'and', rules: [{ field: 'name', op: 'raw_sql' }] },
        },
        { items: ENTITY },
      ),
    ).toThrow(/invalid filter operator/i)
  })
})
