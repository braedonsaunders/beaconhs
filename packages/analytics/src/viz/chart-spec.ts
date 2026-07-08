// A lib-agnostic chart description for Insights visualizations.
// The engine/registry build this from a query result; the single client ECharts
// component maps it to an ECharts option. Keeping it echarts-free means neither
// the engine nor the viz registry ever drags echarts into a bundle.

import type { FlatResult } from '../result'
import type { VizSettings } from './registry'

export type VizChartKind = 'cartesian' | 'pie' | 'scatter' | 'funnel' | 'gauge'

export type VizSeries = {
  name: string
  data: (number | null)[]
  type?: 'bar' | 'line'
  yAxisIndex?: 0 | 1
  areaStyle?: boolean
  color?: string
  /** Per-category bar colors, aligned to xLabels; null → fall back to palette. */
  pointColors?: (string | null)[]
}

export type VizChartSpec = {
  kind: VizChartKind
  cartesianType?: 'bar' | 'line' | 'area'
  orientation?: 'vertical' | 'horizontal'
  stacked?: boolean
  xLabels: string[]
  series: VizSeries[]
  secondaryY?: boolean
  /** Render the value at the end of each bar. */
  showValues?: boolean
  /** Single-series bar/row: give each category its own palette color. */
  colorByPoint?: boolean
  /** Goal/threshold reference lines. */
  markLines?: { y: number; label: string }[]
  /** Gauge: single value + range. */
  gauge?: { value: number; min: number; max: number }
}

function labelOf(v: unknown): string {
  if (v === null || typeof v === 'undefined' || v === '') return '(none)'
  return String(v)
}

// Display labels for category axes prettify enum-style codes (all-lowercase,
// underscore-separated) — "first_aid_only" -> "First aid only" — while leaving
// free-text / already-spaced / mixed-case values untouched.
function displayLabel(v: unknown): string {
  const s = labelOf(v)
  if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(s)) {
    const spaced = s.replace(/_/g, ' ')
    return spaced.charAt(0).toUpperCase() + spaced.slice(1)
  }
  return s
}

function num(v: unknown): number | null {
  if (v === null || typeof v === 'undefined') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Build a chart spec from a flat result for the cartesian / pie / funnel / gauge
 *  family. Returns null when the result can't feed the requested chart. */
export function buildChartSpec(
  result: FlatResult,
  vizKey: string,
  settings: VizSettings = {},
): VizChartSpec | null {
  const dims = result.columns.filter((c) => c.role === 'dimension')
  const measures = result.columns.filter((c) => c.role === 'measure')
  if (measures.length === 0) return null

  const dim = dims[0]
  const rawLabels = dim ? result.rows.map((r) => r[dim.key]) : []
  const xLabels = dim ? rawLabels.map(displayLabel) : measures.map((m) => m.label)
  const showValues = settings.showValues === true
  const colorByCategory = settings.colorByCategory === true
  const colorMap =
    settings.colors && typeof settings.colors === 'object'
      ? (settings.colors as Record<string, unknown>)
      : null

  if (vizKey === 'pie' || vizKey === 'donut') {
    const m = measures[0]!
    return {
      kind: 'pie',
      xLabels,
      series: [{ name: m.label, data: result.rows.map((r) => num(r[m.key])) }],
    }
  }

  if (vizKey === 'funnel') {
    const m = measures[0]!
    return {
      kind: 'funnel',
      xLabels,
      series: [{ name: m.label, data: result.rows.map((r) => num(r[m.key])) }],
    }
  }

  if (vizKey === 'gauge') {
    const m = measures[0]!
    const value = num(result.rows[0]?.[m.key]) ?? 0
    return {
      kind: 'gauge',
      xLabels: [],
      series: [],
      gauge: { value, min: 0, max: Math.max(value, 100) },
    }
  }

  if (vizKey === 'scatter') {
    const [mx, my] = measures
    if (!mx || !my) return null
    return {
      kind: 'scatter',
      xLabels,
      series: [{ name: `${mx.label} × ${my.label}`, data: result.rows.map((r) => num(r[my.key])) }],
    }
  }

  // cartesian: bar / row / line / area / combo
  const cartesianType: 'bar' | 'line' | 'area' =
    vizKey === 'line' ? 'line' : vizKey === 'area' ? 'area' : 'bar'
  const orientation = vizKey === 'row' ? 'horizontal' : 'vertical'
  const single = measures.length === 1
  // Explicit per-category colors (keyed by the RAW value, so the map is stable
  // regardless of how the label is humanized for display).
  const pointColors =
    single && colorMap
      ? rawLabels.map((l) => {
          const c = colorMap[labelOf(l)]
          return typeof c === 'string' ? c : null
        })
      : undefined
  const series: VizSeries[] = measures.map((m, i) => ({
    name: m.label,
    data: result.rows.map((r) => num(r[m.key])),
    // combo: render the 2nd+ measures as lines on a secondary axis.
    type: vizKey === 'combo' && i > 0 ? 'line' : cartesianType === 'line' ? 'line' : 'bar',
    yAxisIndex: vizKey === 'combo' && i > 0 ? 1 : 0,
    areaStyle: cartesianType === 'area',
    pointColors: i === 0 ? pointColors : undefined,
  }))

  return {
    kind: 'cartesian',
    cartesianType,
    orientation,
    xLabels,
    series,
    secondaryY: vizKey === 'combo' && measures.length > 1,
    showValues,
    colorByPoint: single && colorByCategory,
  }
}
