// Server-side sanitiser for the studio's customQuery payload. Client JSON is
// untrusted: entity/columns/operators must resolve through the engine
// whitelists, the filter tree is depth/size-capped, and aggregation specs are
// normalised. Shared by create, update, and preview actions.
//
// The entity whitelist is the DISCOVERED catalog (every tenant-scoped table,
// from @beaconhs/analytics/server) unioned with the legacy static registry for
// back-compat — so any table the builder offers is queryable, and old saved
// reports keep resolving.

import {
  REPORT_AGG_FNS,
  REPORT_CHART_TYPES,
  REPORT_FILTER_OPERATORS,
  REPORT_TEMPORAL_BINS,
  type ReportBreakout,
  type ReportChartConfig,
  type ReportCustomQuery,
  type ReportMeasure,
  type ReportRule,
  type ReportRuleGroup,
} from '@beaconhs/db/schema'
import { REPORT_ENTITY_MAP, type ReportEntity } from '@beaconhs/reports'
import { discoverEntityMap } from '@beaconhs/analytics/server'

const MAX_DEPTH = 5
const MAX_RULES = 60
const MAX_BREAKOUTS = 6
const MAX_MEASURES = 8

/** Resolve an entity key against the provided catalog (the caller may pass a
 *  catalog already augmented with tenant custom-field columns), falling back to
 *  the discovered catalog then the static registry for legacy keys. */
function resolveEntity(key: string, entityMap: Record<string, ReportEntity>): ReportEntity | null {
  return entityMap[key] ?? REPORT_ENTITY_MAP[key] ?? null
}

/**
 * @param entityMap Catalog to validate columns against. Pass a catalog
 *   augmented via `augmentEntityMapWithCustomFields` so custom-field columns
 *   (`cf_*`) survive validation; defaults to the base discovered catalog.
 */
export function validateCustomQuery(
  raw: unknown,
  entityMap: Record<string, ReportEntity> = discoverEntityMap(),
): ReportCustomQuery {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Custom query is required')
  }
  const q = raw as Record<string, unknown>
  const entity = String(q.entity ?? '')
  const entityMeta = resolveEntity(entity, entityMap)
  if (!entityMeta) {
    throw new Error(`Invalid entity: ${entity}`)
  }
  const validColumn = (c: unknown): c is string =>
    typeof c === 'string' && entityMeta.columns.some((col) => col.key === c)

  const mode: 'rows' | 'summarize' = q.mode === 'summarize' ? 'summarize' : 'rows'

  const columns = Array.isArray(q.columns) ? (q.columns as unknown[]).filter(validColumn) : []

  // Summarize: group-by breakouts + aggregate measures.
  const breakouts: ReportBreakout[] = Array.isArray(q.breakouts)
    ? (q.breakouts as unknown[])
        .flatMap((b) => {
          if (!b || typeof b !== 'object') return []
          const o = b as Record<string, unknown>
          if (!validColumn(o.column)) return []
          const bin = REPORT_TEMPORAL_BINS.includes(o.bin as never)
            ? (o.bin as ReportBreakout['bin'])
            : undefined
          return [{ column: o.column, ...(bin ? { bin } : {}) }]
        })
        .slice(0, MAX_BREAKOUTS)
    : []

  let measures: ReportMeasure[] = Array.isArray(q.measures)
    ? (q.measures as unknown[])
        .flatMap((m) => {
          if (!m || typeof m !== 'object') return []
          const o = m as Record<string, unknown>
          const fn = String(o.fn ?? '')
          if (!REPORT_AGG_FNS.includes(fn as never)) return []
          if (fn !== 'count' && !validColumn(o.column)) return []
          const label = typeof o.label === 'string' && o.label.trim() ? o.label.trim() : undefined
          return [
            {
              fn: fn as ReportMeasure['fn'],
              ...(fn === 'count' ? {} : { column: o.column as string }),
              ...(label ? { label } : {}),
            },
          ]
        })
        .slice(0, MAX_MEASURES)
    : []

  if (mode === 'rows' && columns.length === 0) {
    throw new Error('Pick at least one column to include')
  }
  // Summarize is always valid: with no measures the query defaults to a count
  // (and with no breakouts that count is a single grand total).
  if (mode === 'summarize' && measures.length === 0) {
    measures = [{ fn: 'count' }]
  }

  // v1 flat filters (kept for backwards compatibility with older clients).
  const filters = Array.isArray(q.filters)
    ? (q.filters as unknown[]).flatMap((f) => {
        if (!f || typeof f !== 'object') return []
        const o = f as Record<string, unknown>
        if (!validColumn(o.column)) return []
        const op = String(o.op ?? '')
        if (!REPORT_FILTER_OPERATORS.includes(op as never)) return []
        return [
          {
            column: o.column,
            op: op as ReportRule['op'],
            value: sanitizeValue(o.value),
          },
        ]
      })
    : []

  // v2 nested tree.
  let ruleCount = 0
  function sanitizeGroup(g: unknown, depth: number): ReportRuleGroup | null {
    if (!g || typeof g !== 'object' || depth > MAX_DEPTH) return null
    const o = g as Record<string, unknown>
    if (!Array.isArray(o.rules)) return null
    const rules: (ReportRule | ReportRuleGroup)[] = []
    for (const r of o.rules) {
      if (!r || typeof r !== 'object') continue
      if (++ruleCount > MAX_RULES) throw new Error('Too many filter rules')
      const ro = r as Record<string, unknown>
      if (Array.isArray(ro.rules)) {
        const sub = sanitizeGroup(ro, depth + 1)
        if (sub && sub.rules.length) rules.push(sub)
        continue
      }
      const field = ro.field
      const op = String(ro.op ?? ro.operator ?? '')
      if (!validColumn(field) || !REPORT_FILTER_OPERATORS.includes(op as never)) continue
      rules.push({ field, op: op as ReportRule['op'], value: sanitizeValue(ro.value) })
    }
    return {
      combinator: o.combinator === 'or' ? 'or' : 'and',
      ...(o.not === true ? { not: true } : {}),
      rules,
    }
  }
  const filtersV2 = q.filtersV2 ? sanitizeGroup(q.filtersV2, 1) : null
  const filtersV2Final = filtersV2 && filtersV2.rules.length ? filtersV2 : null

  // Chart. In summarize mode the dimension must be one of the breakouts.
  let chart: ReportChartConfig | null = null
  if (q.chart && typeof q.chart === 'object') {
    const c = q.chart as Record<string, unknown>
    const type = String(c.type ?? '')
    const dimOk =
      mode === 'summarize'
        ? breakouts.some((b) => b.column === c.dimension)
        : validColumn(c.dimension)
    if (REPORT_CHART_TYPES.includes(type as never) && dimOk) {
      chart = {
        type: type as ReportChartConfig['type'],
        dimension: c.dimension as string,
        metric: 'count',
      }
    }
  }

  const groupBy = validColumn(q.groupBy) ? q.groupBy : null
  const sort =
    q.sort && typeof q.sort === 'object'
      ? (() => {
          const s = q.sort as Record<string, unknown>
          if (!validColumn(s.column)) return null
          return {
            column: s.column,
            direction: s.direction === 'asc' ? ('asc' as const) : ('desc' as const),
          }
        })()
      : null
  const limit = Number.isFinite(Number(q.limit))
    ? Math.min(Math.max(Number(q.limit), 1), 10_000)
    : 1000

  return {
    entity,
    mode,
    columns,
    breakouts,
    measures,
    filters,
    filtersV2: filtersV2Final,
    chart,
    groupBy,
    sort,
    limit,
  }
}

function sanitizeValue(v: unknown): ReportRule['value'] {
  if (v === null || typeof v === 'undefined') return null
  if (typeof v === 'string' || typeof v === 'number') return v
  if (Array.isArray(v)) {
    const strings = v.filter((x): x is string => typeof x === 'string')
    if (strings.length === v.length) return strings
    const numbers = v.filter((x): x is number => typeof x === 'number')
    if (numbers.length === v.length) return numbers
    return strings
  }
  return String(v)
}
