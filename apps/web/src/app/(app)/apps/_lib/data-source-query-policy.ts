import type { DataSourceColumn } from '@beaconhs/db/schema'

const DATA_SOURCE_MAX_COLUMNS = 100
const DATA_SOURCE_MAX_FILTERS = 50
const DATA_SOURCE_MAX_PAGE_SIZE = 1_000
const DATA_SOURCE_MAX_GROUPS = 1_000
const DATA_SOURCE_MAX_SEARCH_LENGTH = 100
const DATA_SOURCE_MAX_SCALAR_LENGTH = 2_000

const COLUMN_TYPES = new Set<DataSourceColumn['type']>(['text', 'number', 'date', 'boolean'])
const META_KEYS = {
  reference: ['__rowId'],
  responses: ['__rowId', '__status', '__submittedAt', '__site'],
} as const

type DataSourceRuntimeKind = keyof typeof META_KEYS
export type DataSourceFilterValue = string | number | boolean | null
export type NormalizedDataSourceFilter = {
  column: string
  value: DataSourceFilterValue
}

export class DataSourceQueryInputError extends Error {
  override readonly name = 'DataSourceQueryInputError'
}

function fail(message: string): never {
  throw new DataSourceQueryInputError(message)
}

/**
 * Treat the persisted column declaration as an allowlist, not as trusted SQL
 * input. Reserved `__*` keys belong exclusively to the runtime metadata map.
 */
function normalizeDataSourceColumns(input: unknown): DataSourceColumn[] {
  if (!Array.isArray(input)) fail('The data source column declaration is invalid.')
  if (input.length > DATA_SOURCE_MAX_COLUMNS) {
    fail(`A data source may declare at most ${DATA_SOURCE_MAX_COLUMNS} columns.`)
  }

  const keys = new Set<string>()
  return input.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      return fail(`Data source column ${index + 1} is invalid.`)
    }
    const raw = candidate as Record<string, unknown>
    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    const type = raw.type
    if (!key || key.length > 128 || key.startsWith('__')) {
      return fail(`Data source column ${index + 1} has an invalid or reserved key.`)
    }
    if (!label || label.length > 500) {
      return fail(`Data source column ${index + 1} has an invalid label.`)
    }
    if (!COLUMN_TYPES.has(type as DataSourceColumn['type'])) {
      return fail(`Data source column ${index + 1} has an invalid type.`)
    }
    if (keys.has(key)) return fail(`Data source column key "${key}" is duplicated.`)
    keys.add(key)
    return { key, label, type: type as DataSourceColumn['type'] }
  })
}

export type DataSourceColumnPolicy = {
  columns: DataSourceColumn[]
  allowedKeys: ReadonlySet<string>
  searchableKeys: readonly string[]
}

export function createDataSourceColumnPolicy(
  input: unknown,
  kind: DataSourceRuntimeKind,
): DataSourceColumnPolicy {
  const columns = normalizeDataSourceColumns(input)
  const metaKeys = META_KEYS[kind]
  return {
    columns,
    allowedKeys: new Set([...columns.map((column) => column.key), ...metaKeys]),
    searchableKeys: [...columns.map((column) => column.key), ...metaKeys],
  }
}

export function assertDataSourceColumn(
  value: unknown,
  policy: DataSourceColumnPolicy,
  label: string,
): string {
  if (typeof value !== 'string') fail(`${label} must be a data source column key.`)
  const column = value.trim()
  if (!column || column.length > 128 || !policy.allowedKeys.has(column)) {
    fail(`${label} does not name a declared data source column.`)
  }
  return column
}

function normalizeDataSourceScalar(value: unknown, label: string): DataSourceFilterValue {
  if (value === null) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${label} must be a finite scalar value.`)
    return value
  }
  if (typeof value === 'string') {
    if (value.length > DATA_SOURCE_MAX_SCALAR_LENGTH) {
      fail(`${label} is longer than ${DATA_SOURCE_MAX_SCALAR_LENGTH} characters.`)
    }
    return value
  }
  return fail(`${label} must be a string, number, boolean, or null.`)
}

export function normalizeDataSourceFilters(
  policy: DataSourceColumnPolicy,
  args: {
    where?: unknown
    filterColumn?: unknown
    filterValue?: unknown
  },
): { filters: NormalizedDataSourceFilter[]; matchesNone: boolean } {
  const filters: NormalizedDataSourceFilter[] = []
  if (args.where !== undefined) {
    if (!Array.isArray(args.where) || args.where.length > DATA_SOURCE_MAX_FILTERS) {
      fail(`Static filters must contain at most ${DATA_SOURCE_MAX_FILTERS} entries.`)
    }
    for (const [index, candidate] of args.where.entries()) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
        fail(`Static filter ${index + 1} is invalid.`)
      }
      const raw = candidate as Record<string, unknown>
      filters.push({
        column: assertDataSourceColumn(raw.column, policy, `Static filter ${index + 1}`),
        value: normalizeDataSourceScalar(raw.value, `Static filter ${index + 1}`),
      })
    }
  }

  if (args.filterColumn !== undefined) {
    const column = assertDataSourceColumn(args.filterColumn, policy, 'Cascade filter')
    const value = normalizeDataSourceScalar(args.filterValue, 'Cascade filter')
    // A cascade with no parent selection must be empty. It must not silently
    // become an unfiltered query over the entire source.
    if (value === null || value === '') return { filters, matchesNone: true }
    filters.push({ column, value })
  }

  return { filters, matchesNone: false }
}

export function normalizeDataSourceSearch(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') fail('Data source search must be text.')
  const search = value.trim()
  if (search.length > DATA_SOURCE_MAX_SEARCH_LENGTH) {
    fail(`Data source search is longer than ${DATA_SOURCE_MAX_SEARCH_LENGTH} characters.`)
  }
  return search
}

function positiveInteger(value: unknown, fallback: number, maximum: number, label: string): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail(`${label} must be an integer from 1 to ${maximum}.`)
  }
  return value as number
}

export function normalizeDataSourcePage(args: {
  page?: unknown
  pageSize?: unknown
  defaultPageSize: number
}): { page: number; pageSize: number } {
  return {
    page: positiveInteger(args.page, 1, 1_000_000, 'Data source page'),
    pageSize: positiveInteger(
      args.pageSize,
      args.defaultPageSize,
      DATA_SOURCE_MAX_PAGE_SIZE,
      'Data source page size',
    ),
  }
}

export function normalizeDataSourceGroupLimit(value: unknown, fallback = 12): number {
  return positiveInteger(value, fallback, DATA_SOURCE_MAX_GROUPS, 'Data source group limit')
}

export function normalizeDataSourceSelectedValue(
  value: unknown,
): DataSourceFilterValue | undefined {
  if (value === undefined || value === '') return undefined
  return normalizeDataSourceScalar(value, 'Selected lookup value')
}
