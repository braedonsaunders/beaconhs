'use server'

// Tenant-scoped query + aggregate layer for data-bound Builder elements.
// Filters, searches, counts, pagination, and aggregates run in Postgres. Only
// the requested result page crosses the server boundary; aggregate math always
// considers the complete visible and filtered source.

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  dataSourceRows,
  dataSources,
  formResponses,
  formResponseStatus,
  type DataSource,
  type DataSourceColumn,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { moduleScopeWhere } from '@/lib/visibility'
import {
  DataSourceQueryInputError,
  assertDataSourceColumn,
  createDataSourceColumnPolicy,
  normalizeDataSourceFilters,
  normalizeDataSourceGroupLimit,
  normalizeDataSourcePage,
  normalizeDataSourceSearch,
  normalizeDataSourceSelectedValue,
  type DataSourceColumnPolicy,
  type DataSourceFilterValue,
  type NormalizedDataSourceFilter,
} from './data-source-query-policy'

export type DataSourceSummary = {
  id: string
  key: string
  name: string
  kind: 'reference' | 'responses'
  columns: DataSourceColumn[]
}

export type DataRow = Record<string, unknown>

export type DataQueryResult = {
  columns: DataSourceColumn[]
  rows: DataRow[]
  total: number
  page: number
  pageSize: number
  /** Hydrated independently so a saved lookup remains labelled while searching. */
  selectedRow: DataRow | null
}

export type DataAggregateResult = {
  value: number | null
  groups?: { key: string; value: number }[]
  /** Exact visible row count after filters; never limited by chart display size. */
  total: number
}

type WhereClause = { column: string; value: unknown }
type AggregateFn = 'count' | 'sum' | 'avg' | 'min' | 'max'
type JsonDataColumn = typeof dataSourceRows.data | typeof formResponses.data
type TextResolver = (key: string) => SQL<string | null>
type JsonResolver = (key: string) => SQL<unknown> | null

const AGGREGATE_FNS = new Set<AggregateFn>(['count', 'sum', 'avg', 'min', 'max'])
const RESPONSE_STATUSES = new Set<string>(formResponseStatus.enumValues)

function normalizeSourceKey(value: unknown): string {
  if (typeof value !== 'string') throw new DataSourceQueryInputError('Data source key is invalid.')
  const key = value.trim()
  if (!key || key.length > 128 || key !== value) {
    throw new DataSourceQueryInputError('Data source key is invalid.')
  }
  return key
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function projectDeclaredData(
  data: Record<string, unknown> | null,
  columns: readonly DataSourceColumn[],
): DataRow {
  const projected: DataRow = {}
  for (const column of columns) projected[column.key] = data?.[column.key] ?? null
  return projected
}

function referenceRow(
  row: { id: string; data: Record<string, unknown> },
  columns: readonly DataSourceColumn[],
): DataRow {
  return { ...projectDeclaredData(row.data, columns), __rowId: row.id }
}

function responseRow(
  row: {
    id: string
    data: Record<string, unknown>
    status: string
    submittedAt: Date | null
    siteOrgUnitId: string | null
  },
  columns: readonly DataSourceColumn[],
): DataRow {
  return {
    ...projectDeclaredData(row.data, columns),
    __rowId: row.id,
    __status: row.status,
    __submittedAt: row.submittedAt?.toISOString() ?? null,
    __site: row.siteOrgUnitId,
  }
}

function jsonText(column: JsonDataColumn, key: string): SQL<string | null> {
  return sql<string | null>`${column} ->> ${key}`
}

function jsonValue(column: JsonDataColumn, key: string): SQL<unknown> {
  return sql<unknown>`${column} -> ${key}`
}

function referenceText(key: string): SQL<string | null> {
  if (key === '__rowId') return sql<string>`${dataSourceRows.id}::text`
  return jsonText(dataSourceRows.data, key)
}

function referenceJson(key: string): SQL<unknown> | null {
  return key.startsWith('__') ? null : jsonValue(dataSourceRows.data, key)
}

function responseText(key: string): SQL<string | null> {
  if (key === '__rowId') return sql<string>`${formResponses.id}::text`
  if (key === '__status') return sql<string>`${formResponses.status}::text`
  if (key === '__site') return sql<string | null>`${formResponses.siteOrgUnitId}::text`
  if (key === '__submittedAt') {
    return sql<
      string | null
    >`to_char(${formResponses.submittedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
  }
  return jsonText(formResponses.data, key)
}

function responseJson(key: string): SQL<unknown> | null {
  return key.startsWith('__') ? null : jsonValue(formResponses.data, key)
}

/** Match the former runtime's scalar semantics without loading JSON into JS. */
function normalizedScalarText(
  text: SQL<string | null>,
  json: SQL<unknown> | null,
): SQL<string | null> {
  if (!json) return text
  return sql<string | null>`case
    when jsonb_typeof(${json}) = 'number'
      and pg_input_is_valid(btrim(${text}), 'double precision')
      then ((${text})::double precision)::text
    when jsonb_typeof(${json}) in ('string', 'boolean') then ${text}
    else null
  end`
}

function numericValue(text: SQL<string | null>, json: SQL<unknown> | null): SQL<number | null> {
  const scalarType = json ? sql<string | null>`jsonb_typeof(${json})` : null
  return sql<number | null>`case
    when ${scalarType ?? sql`null`} = 'boolean' and lower(${text}) = 'true' then 1::double precision
    when ${scalarType ?? sql`null`} = 'boolean' and lower(${text}) = 'false' then 0::double precision
    when (${scalarType ?? sql`null`} is null or ${scalarType ?? sql`null`} in ('number', 'string'))
      and pg_input_is_valid(btrim(${text}), 'double precision')
      and lower(btrim(${text})) not in ('nan', 'infinity', '+infinity', '-infinity')
      then (${text})::double precision
    else null
  end`
}

function filterPredicates(
  filters: readonly NormalizedDataSourceFilter[],
  textFor: TextResolver,
  jsonFor: JsonResolver,
): SQL[] {
  return filters.map(({ column, value }) => {
    const expression = normalizedScalarText(textFor(column), jsonFor(column))
    return value === null ? sql`${expression} is null` : sql`${expression} = ${String(value)}`
  })
}

function searchPredicate(
  search: string,
  policy: DataSourceColumnPolicy,
  textFor: TextResolver,
  jsonFor: JsonResolver,
): SQL | undefined {
  if (!search) return undefined
  const terms = policy.searchableKeys.map((key) => {
    const expression = normalizedScalarText(textFor(key), jsonFor(key))
    // strpos treats %, _, and backslashes literally and the value remains bound.
    return sql`strpos(lower(coalesce(${expression}, '')), lower(${search})) > 0`
  })
  return terms.length > 0 ? or(...terms) : sql`false`
}

function selectedPredicate(
  selectedValue: DataSourceFilterValue | undefined,
  valueColumn: string,
  textFor: TextResolver,
  jsonFor: JsonResolver,
): SQL | undefined {
  if (selectedValue === undefined) return undefined
  const expression = normalizedScalarText(textFor(valueColumn), jsonFor(valueColumn))
  return selectedValue === null
    ? sql`${expression} is null`
    : sql`${expression} = ${String(selectedValue)}`
}

function responseStatusPredicate(source: DataSource): SQL | undefined {
  const statuses: unknown = source.config?.statuses
  if (statuses === undefined || (Array.isArray(statuses) && statuses.length === 0)) return undefined
  if (
    !Array.isArray(statuses) ||
    statuses.length > formResponseStatus.enumValues.length ||
    statuses.some((status) => typeof status !== 'string' || !RESPONSE_STATUSES.has(status))
  ) {
    throw new DataSourceQueryInputError('The response data source status filter is invalid.')
  }
  const unique = [...new Set(statuses)] as (typeof formResponseStatus.enumValues)[number][]
  return unique.length > 0 ? inArray(formResponses.status, unique) : undefined
}

function responseTemplatePredicate(source: DataSource): SQL {
  const templateId: unknown = source.config?.templateId
  if (templateId === undefined || templateId === null || templateId === '') return sql`false`
  if (typeof templateId !== 'string' || !isUuid(templateId)) {
    throw new DataSourceQueryInputError('The response data source template is invalid.')
  }
  return eq(formResponses.templateId, templateId)
}

function aggregateExpression(
  fn: AggregateFn,
  number: SQL<number | null> | null,
  coalesceEmpty: boolean,
): SQL<number | string | null> {
  if (fn === 'count') return sql<number>`count(*)::double precision`
  if (!number) throw new DataSourceQueryInputError(`Aggregate ${fn} requires a column.`)
  const expression =
    fn === 'sum'
      ? sql<number | null>`sum(${number})`
      : fn === 'avg'
        ? sql<number | null>`avg(${number})`
        : fn === 'min'
          ? sql<number | null>`min(${number})`
          : sql<number | null>`max(${number})`
  return coalesceEmpty ? sql<number>`coalesce(${expression}, 0)` : expression
}

function groupKeyExpression(text: SQL<string | null>, json: SQL<unknown> | null): SQL<string> {
  return sql<string>`coalesce(nullif(${normalizedScalarText(text, json)}, ''), '—')`
}

async function resolveSource(tx: Database, sourceKey: string): Promise<DataSource | null> {
  const [source] = await tx
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.key, sourceKey), isNull(dataSources.deletedAt)))
    .limit(1)
  return source ?? null
}

function emptyQueryResult(page: number, pageSize: number): DataQueryResult {
  return { columns: [], rows: [], total: 0, page, pageSize, selectedRow: null }
}

/** List every data source in the tenant for the binding editor. */
export async function listDataSources(): Promise<DataSourceSummary[]> {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'forms.template.create')) return []
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: dataSources.id,
        key: dataSources.key,
        name: dataSources.name,
        kind: dataSources.kind,
        columns: dataSources.columns,
      })
      .from(dataSources)
      .where(isNull(dataSources.deletedAt))
      .orderBy(asc(dataSources.name), asc(dataSources.id))
    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      kind: row.kind,
      columns: createDataSourceColumnPolicy(row.columns, row.kind).columns,
    }))
  })
}

/**
 * Query one exact result page for a remote lookup or data table. `pageSize`
 * bounds only the returned page. It never limits the rows eligible for filters
 * or the exact `total`. A selected lookup value is hydrated separately.
 */
export async function queryDataSource(args: {
  sourceKey: string
  where?: WhereClause[]
  filterColumn?: string
  filterValue?: unknown
  search?: string
  page?: number
  pageSize?: number
  valueColumn?: string
  selectedValue?: unknown
}): Promise<DataQueryResult> {
  const sourceKey = normalizeSourceKey(args.sourceKey)
  const { page, pageSize } = normalizeDataSourcePage({
    page: args.page,
    pageSize: args.pageSize,
    defaultPageSize: 25,
  })
  const search = normalizeDataSourceSearch(args.search)
  const selectedValue = normalizeDataSourceSelectedValue(args.selectedValue)
  const ctx = await requireRequestContext()

  return ctx.db(async (tx) => {
    const source = await resolveSource(tx, sourceKey)
    if (!source) return emptyQueryResult(page, pageSize)
    const policy = createDataSourceColumnPolicy(source.columns, source.kind)
    const { filters, matchesNone } = normalizeDataSourceFilters(policy, args)
    const valueColumn = args.valueColumn
      ? assertDataSourceColumn(args.valueColumn, policy, 'Lookup value column')
      : '__rowId'

    if (source.kind === 'reference') {
      const predicates = filterPredicates(filters, referenceText, referenceJson)
      const filteredWhere = and(
        eq(dataSourceRows.dataSourceId, source.id),
        isNull(dataSourceRows.deletedAt),
        matchesNone ? sql`false` : undefined,
        ...predicates,
      )
      const where = and(
        filteredWhere,
        searchPredicate(search, policy, referenceText, referenceJson),
      )
      const [totalRow] = await tx.select({ total: count() }).from(dataSourceRows).where(where)
      const rawRows = await tx
        .select({ id: dataSourceRows.id, data: dataSourceRows.data })
        .from(dataSourceRows)
        .where(where)
        .orderBy(asc(dataSourceRows.position), asc(dataSourceRows.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize)

      const selected = selectedPredicate(selectedValue, valueColumn, referenceText, referenceJson)
      const [selectedRaw] = selected
        ? await tx
            .select({ id: dataSourceRows.id, data: dataSourceRows.data })
            .from(dataSourceRows)
            .where(and(filteredWhere, selected))
            .orderBy(asc(dataSourceRows.position), asc(dataSourceRows.id))
            .limit(1)
        : []

      return {
        columns: policy.columns,
        rows: rawRows.map((row) => referenceRow(row, policy.columns)),
        total: Number(totalRow?.total ?? 0),
        page,
        pageSize,
        selectedRow: selectedRaw ? referenceRow(selectedRaw, policy.columns) : null,
      }
    }

    const visibility = await moduleScopeWhere(ctx, tx, {
      prefix: 'forms.response',
      ownerCols: [formResponses.submittedBy],
      personCol: formResponses.subjectPersonId,
      siteCol: formResponses.siteOrgUnitId,
    })
    const predicates = filterPredicates(filters, responseText, responseJson)
    const filteredWhere = and(
      responseTemplatePredicate(source),
      isNotNull(formResponses.submittedAt),
      isNull(formResponses.deletedAt),
      responseStatusPredicate(source),
      visibility,
      matchesNone ? sql`false` : undefined,
      ...predicates,
    )
    const where = and(filteredWhere, searchPredicate(search, policy, responseText, responseJson))
    const [totalRow] = await tx.select({ total: count() }).from(formResponses).where(where)
    const rawRows = await tx
      .select({
        id: formResponses.id,
        data: formResponses.data,
        status: formResponses.status,
        submittedAt: formResponses.submittedAt,
        siteOrgUnitId: formResponses.siteOrgUnitId,
      })
      .from(formResponses)
      .where(where)
      .orderBy(desc(formResponses.submittedAt), desc(formResponses.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    const selected = selectedPredicate(selectedValue, valueColumn, responseText, responseJson)
    const [selectedRaw] = selected
      ? await tx
          .select({
            id: formResponses.id,
            data: formResponses.data,
            status: formResponses.status,
            submittedAt: formResponses.submittedAt,
            siteOrgUnitId: formResponses.siteOrgUnitId,
          })
          .from(formResponses)
          .where(and(filteredWhere, selected))
          .orderBy(desc(formResponses.submittedAt), desc(formResponses.id))
          .limit(1)
      : []

    return {
      columns: policy.columns,
      rows: rawRows.map((row) => responseRow(row, policy.columns)),
      total: Number(totalRow?.total ?? 0),
      page,
      pageSize,
      selectedRow: selectedRaw ? responseRow(selectedRaw, policy.columns) : null,
    }
  })
}

/**
 * Compute an exact aggregate over the complete visible, filtered source.
 * `groupLimit` controls only how many sorted groups are returned for display.
 */
export async function aggregateDataSource(args: {
  sourceKey: string
  fn: AggregateFn
  column?: string
  groupBy?: string
  where?: WhereClause[]
  filterColumn?: string
  filterValue?: unknown
  groupLimit?: number
}): Promise<DataAggregateResult> {
  const sourceKey = normalizeSourceKey(args.sourceKey)
  if (!AGGREGATE_FNS.has(args.fn)) {
    throw new DataSourceQueryInputError('Data source aggregate function is invalid.')
  }
  const ctx = await requireRequestContext()

  return ctx.db(async (tx) => {
    const source = await resolveSource(tx, sourceKey)
    if (!source) return { value: null, total: 0 }
    const policy = createDataSourceColumnPolicy(source.columns, source.kind)
    const { filters, matchesNone } = normalizeDataSourceFilters(policy, args)
    const column =
      args.fn === 'count'
        ? undefined
        : assertDataSourceColumn(args.column, policy, `${args.fn} aggregate column`)
    const groupBy = args.groupBy
      ? assertDataSourceColumn(args.groupBy, policy, 'Aggregate group column')
      : undefined
    const groupLimit = groupBy ? normalizeDataSourceGroupLimit(args.groupLimit) : undefined

    if (source.kind === 'reference') {
      const where = and(
        eq(dataSourceRows.dataSourceId, source.id),
        isNull(dataSourceRows.deletedAt),
        matchesNone ? sql`false` : undefined,
        ...filterPredicates(filters, referenceText, referenceJson),
      )
      if (groupBy && groupLimit) {
        const keyExpression = groupKeyExpression(referenceText(groupBy), referenceJson(groupBy))
        const numberExpression = column
          ? numericValue(referenceText(column), referenceJson(column))
          : null
        const valueExpression = aggregateExpression(args.fn, numberExpression, true)
        const [groupRows, totalRows] = await Promise.all([
          tx
            .select({ key: keyExpression, value: valueExpression })
            .from(dataSourceRows)
            .where(where)
            .groupBy(keyExpression)
            .orderBy(desc(valueExpression), asc(keyExpression))
            .limit(groupLimit),
          tx.select({ total: count() }).from(dataSourceRows).where(where),
        ])
        return {
          value: null,
          groups: groupRows.map((row) => ({ key: row.key, value: finiteNumber(row.value) ?? 0 })),
          total: Number(totalRows[0]?.total ?? 0),
        }
      }

      const numberExpression = column
        ? numericValue(referenceText(column), referenceJson(column))
        : null
      const [row] = await tx
        .select({
          value: aggregateExpression(args.fn, numberExpression, false),
          total: count(),
        })
        .from(dataSourceRows)
        .where(where)
      return { value: finiteNumber(row?.value), total: Number(row?.total ?? 0) }
    }

    const visibility = await moduleScopeWhere(ctx, tx, {
      prefix: 'forms.response',
      ownerCols: [formResponses.submittedBy],
      personCol: formResponses.subjectPersonId,
      siteCol: formResponses.siteOrgUnitId,
    })
    const where = and(
      responseTemplatePredicate(source),
      isNotNull(formResponses.submittedAt),
      isNull(formResponses.deletedAt),
      responseStatusPredicate(source),
      visibility,
      matchesNone ? sql`false` : undefined,
      ...filterPredicates(filters, responseText, responseJson),
    )
    if (groupBy && groupLimit) {
      const keyExpression = groupKeyExpression(responseText(groupBy), responseJson(groupBy))
      const numberExpression = column
        ? numericValue(responseText(column), responseJson(column))
        : null
      const valueExpression = aggregateExpression(args.fn, numberExpression, true)
      const [groupRows, totalRows] = await Promise.all([
        tx
          .select({ key: keyExpression, value: valueExpression })
          .from(formResponses)
          .where(where)
          .groupBy(keyExpression)
          .orderBy(desc(valueExpression), asc(keyExpression))
          .limit(groupLimit),
        tx.select({ total: count() }).from(formResponses).where(where),
      ])
      return {
        value: null,
        groups: groupRows.map((row) => ({ key: row.key, value: finiteNumber(row.value) ?? 0 })),
        total: Number(totalRows[0]?.total ?? 0),
      }
    }

    const numberExpression = column
      ? numericValue(responseText(column), responseJson(column))
      : null
    const [row] = await tx
      .select({
        value: aggregateExpression(args.fn, numberExpression, false),
        total: count(),
      })
      .from(formResponses)
      .where(where)
    return { value: finiteNumber(row?.value), total: Number(row?.total ?? 0) }
  })
}
