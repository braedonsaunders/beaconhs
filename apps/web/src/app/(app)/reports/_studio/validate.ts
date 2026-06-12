// Server-side sanitiser for the studio's customQuery payload. Client JSON is
// untrusted: entity/columns/operators must resolve through the engine
// whitelists, the filter tree is depth/size-capped, and the chart config is
// normalised. Shared by create, update, and preview actions.

import {
  REPORT_CHART_TYPES,
  REPORT_CUSTOM_ENTITIES,
  REPORT_FILTER_OPERATORS,
  type ReportChartConfig,
  type ReportCustomQuery,
  type ReportRule,
  type ReportRuleGroup,
} from '@beaconhs/db/schema'
import { REPORT_ENTITY_MAP } from '@beaconhs/reports'

const MAX_DEPTH = 5
const MAX_RULES = 60

export function validateCustomQuery(raw: unknown): ReportCustomQuery {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Custom query is required')
  }
  const q = raw as Record<string, unknown>
  const entity = String(q.entity ?? '')
  if (!REPORT_CUSTOM_ENTITIES.includes(entity as never)) {
    throw new Error(`Invalid entity: ${entity}`)
  }
  const entityMeta = REPORT_ENTITY_MAP[entity]!
  const validColumn = (c: unknown): c is string =>
    typeof c === 'string' && entityMeta.columns.some((col) => col.key === c)

  const columns = Array.isArray(q.columns) ? (q.columns as unknown[]).filter(validColumn) : []
  if (columns.length === 0) {
    throw new Error('Pick at least one column to include')
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

  // Chart.
  let chart: ReportChartConfig | null = null
  if (q.chart && typeof q.chart === 'object') {
    const c = q.chart as Record<string, unknown>
    const type = String(c.type ?? '')
    if (REPORT_CHART_TYPES.includes(type as never) && validColumn(c.dimension)) {
      chart = { type: type as ReportChartConfig['type'], dimension: c.dimension, metric: 'count' }
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
    entity: entity as ReportCustomQuery['entity'],
    columns,
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
