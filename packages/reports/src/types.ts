// Result shapes shared by every report runner. The same RunResult feeds the
// in-app viewer (tables + charts), the CSV/XLSX export routes, and the
// worker's scheduled-PDF pipeline (ReportGroup is structurally identical to
// @beaconhs/forms-pdf's ReportGroup, so groups flow straight into the PDF
// renderer without a translation layer).

export type ReportGroup = {
  title: string
  /** Optional second line under the group title (e.g. count or status). */
  subtitle?: string
  /** Column headings (display labels). */
  columns: string[]
  /** Rows aligned to `columns`. Cell values are coerced to string. */
  rows: (string | number | null | undefined)[][]
  /** If true, render an "empty" placeholder row instead of the table. */
  isEmpty?: boolean
}

/** Chart-library-agnostic chart description. The web app maps this onto an
 *  ECharts option; keeping the spec generic keeps echarts out of this
 *  package (and out of the worker bundle). */
export type ReportChartSpec = {
  id: string
  title: string
  type: 'bar' | 'line' | 'area' | 'pie' | 'donut'
  /** Category labels — x axis for bar/line/area, slice names for pie/donut. */
  xLabels: string[]
  /** One or more series aligned to xLabels. Pie/donut read series[0]. */
  series: { name: string; data: number[] }[]
  /** Stack multi-series bar/area charts. */
  stacked?: boolean
}

export type ReportSummaryItem = { label: string; value: string | number }

export type ReportRunResult = {
  groups: ReportGroup[]
  summary: ReportSummaryItem[]
  charts: ReportChartSpec[]
  rowCount: number
}

export type ReportRange = { from: Date; to: Date; label: string }

// --- Small shared formatting helpers ---------------------------------------

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function formatLabel(s: string): string {
  return (s ?? '').replace(/_/g, ' ')
}

export function pickUuid(v: unknown): string | null {
  if (typeof v !== 'string') return null
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null
}
