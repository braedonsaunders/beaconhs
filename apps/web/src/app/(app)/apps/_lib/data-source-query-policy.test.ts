import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  DataSourceQueryInputError,
  createDataSourceColumnPolicy,
  normalizeDataSourceFilters,
  normalizeDataSourceGroupLimit,
  normalizeDataSourcePage,
  normalizeDataSourceSearch,
  normalizeDataSourceSelectedValue,
} from './data-source-query-policy'

const COLUMNS = [
  { key: 'name', label: 'Name', type: 'text' as const },
  { key: 'score', label: 'Score', type: 'number' as const },
]

describe('data source query policy', () => {
  it('allows only declared columns and the metadata owned by each source kind', () => {
    const reference = createDataSourceColumnPolicy(COLUMNS, 'reference')
    const responses = createDataSourceColumnPolicy(COLUMNS, 'responses')

    expect([...reference.allowedKeys]).toEqual(['name', 'score', '__rowId'])
    expect([...responses.allowedKeys]).toEqual([
      'name',
      'score',
      '__rowId',
      '__status',
      '__submittedAt',
      '__site',
    ])
    expect(() =>
      normalizeDataSourceFilters(reference, {
        where: [{ column: '__status', value: 'submitted' }],
      }),
    ).toThrow(DataSourceQueryInputError)
  })

  it('rejects malformed, duplicate, and reserved persisted column declarations', () => {
    expect(() =>
      createDataSourceColumnPolicy(
        [...COLUMNS, { key: 'name', label: 'Duplicate', type: 'text' }],
        'reference',
      ),
    ).toThrow(/duplicated/)
    expect(() =>
      createDataSourceColumnPolicy(
        [{ key: '__rowId', label: 'Override', type: 'text' }],
        'reference',
      ),
    ).toThrow(/reserved/)
    expect(() =>
      createDataSourceColumnPolicy([{ key: 'name', label: 'Name', type: 'object' }], 'reference'),
    ).toThrow(/invalid type/)
  })

  it('normalizes static and cascade filters without accepting structured values', () => {
    const policy = createDataSourceColumnPolicy(COLUMNS, 'reference')
    expect(
      normalizeDataSourceFilters(policy, {
        where: [
          { column: 'score', value: 7 },
          { column: 'name', value: null },
        ],
        filterColumn: '__rowId',
        filterValue: '7de7f6a5-811d-463b-9818-cfbf726c154f',
      }),
    ).toEqual({
      filters: [
        { column: 'score', value: 7 },
        { column: 'name', value: null },
        { column: '__rowId', value: '7de7f6a5-811d-463b-9818-cfbf726c154f' },
      ],
      matchesNone: false,
    })
    expect(() =>
      normalizeDataSourceFilters(policy, { where: [{ column: 'name', value: ['unsafe'] }] }),
    ).toThrow(/string, number, boolean, or null/)
  })

  it('fails a cascade closed until its parent has a value', () => {
    const policy = createDataSourceColumnPolicy(COLUMNS, 'reference')
    expect(normalizeDataSourceFilters(policy, { filterColumn: 'name', filterValue: '' })).toEqual({
      filters: [],
      matchesNone: true,
    })
    expect(normalizeDataSourceFilters(policy, { filterColumn: 'name', filterValue: null })).toEqual(
      { filters: [], matchesNone: true },
    )
  })

  it('bounds result pages and aggregate group displays instead of source rows', () => {
    expect(normalizeDataSourcePage({ defaultPageSize: 25 })).toEqual({ page: 1, pageSize: 25 })
    expect(normalizeDataSourcePage({ page: 8, pageSize: 1000, defaultPageSize: 25 })).toEqual({
      page: 8,
      pageSize: 1000,
    })
    expect(() => normalizeDataSourcePage({ pageSize: 1001, defaultPageSize: 25 })).toThrow(
      /1 to 1000/,
    )
    expect(normalizeDataSourceGroupLimit(undefined)).toBe(12)
    expect(() => normalizeDataSourceGroupLimit(1001)).toThrow(/1 to 1000/)
  })

  it('bounds remote search and selected-value hydration inputs', () => {
    expect(normalizeDataSourceSearch('  north yard  ')).toBe('north yard')
    expect(() => normalizeDataSourceSearch('x'.repeat(101))).toThrow(/longer than 100/)
    expect(normalizeDataSourceSelectedValue('asset-17')).toBe('asset-17')
    expect(normalizeDataSourceSelectedValue('')).toBeUndefined()
    expect(() => normalizeDataSourceSelectedValue(Number.POSITIVE_INFINITY)).toThrow(/finite/)
  })

  it('keeps source-row caps out of the database query and aggregate runtime', () => {
    const runtime = readFileSync(new URL('./data-sources.ts', import.meta.url), 'utf8')
    expect(runtime).not.toMatch(/ROW_CAP|fetchRows|applyFilters/)
    expect(runtime).toContain('.select({ total: count() })')
    expect(runtime).toContain('.limit(pageSize)')
    expect(runtime).toContain('.limit(groupLimit)')
  })
})
