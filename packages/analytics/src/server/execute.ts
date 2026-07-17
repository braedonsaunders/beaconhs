// BHQL executor. Runs a compiled query on a caller-provided transaction that is
// ALREADY tenant-scoped (web passes ctx.db's tx → RLS via app.tenant_id; worker
// passes a withTenant tx). This module NEVER opens a transaction or sets the
// tenant GUC — RLS stays the only tenancy boundary, exactly like the report
// executor it mirrors.

import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { insightCards, type BhqlMeasure, type BhqlPivot, type BhqlQuery } from '@beaconhs/db/schema'
import { extractRows } from '@beaconhs/reports'
import { parseBhqlQuery } from '../ast-schema'
import { discoverEntityMapWithCustomFields } from './custom-fields'
import type { AnalyticsEntity } from '../semantic'
import type {
  BhqlResult,
  FlatResult,
  PivotAxisKey,
  PivotCell,
  PivotResult,
  ResultColumn,
  ResultDataType,
} from '../result'
import { compileBhql, type CompiledBhql } from './compile'

/** Wide pivots become unrenderable DOM; cap distinct column tuples. */
const MAX_PIVOT_COLUMNS = 100

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Normalise a raw DB value to the column's intended JS type. postgres-js returns
 *  bigint/numeric as strings and timestamps as Date — make them wire-safe. */
function coerce(v: unknown, dataType: ResultDataType): unknown {
  if (v === null || typeof v === 'undefined') return null
  switch (dataType) {
    case 'number': {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    case 'date':
      return v instanceof Date ? isoDate(v) : String(v)
    case 'timestamp':
      return v instanceof Date ? v.toISOString() : String(v)
    case 'boolean':
      return Boolean(v)
    default:
      return typeof v === 'string' ? v : String(v)
  }
}

function labelValue(v: unknown): string {
  if (v === null || typeof v === 'undefined' || v === '') return '(none)'
  if (v instanceof Date) return isoDate(v)
  return String(v)
}

/** Expand reusable Metric references into joined sources by loading each metric
 *  card (kind='metric') under the caller's RLS tx, so editing the metric
 *  propagates to every card that references it. The metric's single base measure
 *  is re-aliased to the reference's alias and joined on the mapped grain. */
async function resolveMetricRefs(tx: Database, query: BhqlQuery): Promise<BhqlQuery> {
  const stage = query.stages[0]
  if (!stage?.metricRefs?.length) return query
  const joinedSources = [...(stage.joinedSources ?? [])]
  for (const ref of stage.metricRefs) {
    const [card] = await tx
      .select({ query: insightCards.query, config: insightCards.config })
      .from(insightCards)
      .where(
        and(
          eq(insightCards.id, ref.metricId),
          eq(insightCards.kind, 'metric'),
          isNull(insightCards.deletedAt),
        ),
      )
      .limit(1)
    if (!card) throw new Error('A referenced metric was not found.')
    const mStage = (card.query as BhqlQuery).stages?.[0]
    const measure = mStage?.aggregations?.[0]
    if (!mStage || !measure || (measure as { kind?: string }).kind === 'calc') {
      throw new Error('A referenced metric is malformed (it needs a single base measure).')
    }
    joinedSources.push({
      source: mStage.source,
      filter: mStage.filter ?? null,
      measures: [{ ...(measure as BhqlMeasure), alias: ref.alias }],
      on: ref.on,
    })
  }
  return { ...query, stages: [{ ...stage, joinedSources, metricRefs: undefined }] }
}

export async function runBhql(
  tx: Database,
  query: unknown,
  opts: { maxRows?: number; entityMap?: Record<string, AnalyticsEntity> } = {},
): Promise<BhqlResult> {
  // Re-validate at the execution boundary (defence in depth — a caller may pass
  // raw jsonb straight from the DB). Resolve the registry once from the schema,
  // augmented with this tenant's custom-field columns so cards that reference
  // them compile + run.
  const entityMap = opts.entityMap ?? (await discoverEntityMapWithCustomFields(tx))
  let parsed = parseBhqlQuery(query, entityMap)
  // Reusable metrics are loaded + expanded into joined sources here (live), then
  // the expanded query is RE-validated before compiling.
  if (parsed.stages[0]?.metricRefs?.length) {
    parsed = parseBhqlQuery(await resolveMetricRefs(tx, parsed), entityMap)
  }
  const compiled = compileBhql(parsed, { ...opts, entityMap })
  const raw = (await tx.execute(compiled.sql)) as unknown
  const dataRows = extractRows(raw)
  const flat = assembleFlat(compiled, dataRows)
  if (parsed.display === 'pivot' && parsed.pivot) return reshapePivot(flat, parsed.pivot)
  return flat
}

function assembleFlat(compiled: CompiledBhql, dataRows: Record<string, unknown>[]): FlatResult {
  const rows = dataRows.map((r) => {
    const out: Record<string, unknown> = {}
    for (const c of compiled.columns) out[c.key] = coerce(r[c.key], c.dataType)
    return out
  })
  return {
    shape: 'flat',
    columns: compiled.columns,
    rows,
    rowCount: rows.length,
    truncated: rows.length >= compiled.effectiveLimit,
  }
}

export function reshapePivot(flat: FlatResult, pivot: BhqlPivot): PivotResult {
  const colByKey = new Map(flat.columns.map((c) => [c.key, c]))
  const pick = (keys: string[]): ResultColumn[] =>
    keys.map((k) => colByKey.get(k)).filter((c): c is ResultColumn => Boolean(c))

  const rowDims = pick(pivot.rows.map((r) => r.breakout))
  const columnDims = pick(pivot.columns.map((c) => c.breakout))
  const valueMeasures = pick(pivot.values.map((v) => v.measure))

  const keyOf = (row: Record<string, unknown>, dims: ResultColumn[]): string =>
    dims.map((d) => String(row[d.key] ?? '')).join('\u0000')
  const hasAxisValue = (row: Record<string, unknown>, dims: ResultColumn[]): boolean =>
    dims.some((d) => {
      const value = row[d.key]
      return value !== null && typeof value !== 'undefined' && value !== ''
    })

  const rowIndex = new Map<string, number>()
  const colIndex = new Map<string, number>()
  const rowKeys: PivotAxisKey[] = []
  const columnKeys: PivotAxisKey[] = []

  for (const row of flat.rows) {
    const rk = keyOf(row, rowDims)
    if (!rowIndex.has(rk)) {
      rowIndex.set(rk, rowKeys.length)
      rowKeys.push({
        values: rowDims.map((d) => row[d.key] ?? null),
        labels: rowDims.map((d) => labelValue(row[d.key])),
      })
    }
    // A pivot cannot give an empty column tuple a useful heading. Dropping it
    // prevents a phantom "(none)" column while retaining partially populated
    // multi-dimension tuples.
    if (!hasAxisValue(row, columnDims)) continue
    const ck = keyOf(row, columnDims)
    if (!colIndex.has(ck)) {
      if (columnKeys.length >= MAX_PIVOT_COLUMNS) {
        throw new Error(
          `This pivot has more than ${MAX_PIVOT_COLUMNS} columns. Add a filter or use fewer column groups.`,
        )
      }
      colIndex.set(ck, columnKeys.length)
      columnKeys.push({
        values: columnDims.map((d) => row[d.key] ?? null),
        labels: columnDims.map((d) => labelValue(row[d.key])),
      })
    }
  }

  const cells: (PivotCell | null)[][] = rowKeys.map(() => columnKeys.map(() => null))
  for (const row of flat.rows) {
    if (!hasAxisValue(row, columnDims)) continue
    const ri = rowIndex.get(keyOf(row, rowDims))
    const ci = colIndex.get(keyOf(row, columnDims))
    if (ri === undefined || ci === undefined) continue
    const cell: PivotCell = {}
    for (const m of valueMeasures) cell[m.key] = row[m.key] ?? null
    cells[ri]![ci] = cell
  }

  return {
    shape: 'pivot',
    rowDimensions: rowDims,
    columnDimensions: columnDims,
    valueMeasures,
    rowKeys,
    columnKeys,
    cells,
    rowCount: flat.rowCount,
    truncated: flat.truncated,
  }
}
