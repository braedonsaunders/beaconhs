// Result shapes shared by every report runner. The same RunResult feeds the
// in-app paginated document preview, the CSV/XLSX export routes, and the
// worker's scheduled-PDF pipeline — one shape, one printed document.

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

export type ReportSummaryItem = { label: string; value: string | number }

export type ReportRunResult = {
  groups: ReportGroup[]
  summary: ReportSummaryItem[]
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
