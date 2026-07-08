// The report DOCUMENT renderer — the single template behind the in-app
// paginated preview (Paged.js in the browser), the on-demand PDF export, and
// the worker's scheduled-PDF pipeline. Pure string building: no puppeteer, no
// React — safe to import from web server components and the worker alike.
//
// Page-number strategy: the browser preview draws them with @page margin
// boxes (pass opts.marginBoxes to buildReportPageCss); Chromium print omits
// the margin boxes and uses Puppeteer's footerTemplate instead. Both derive
// paper size + margins from the same ReportLayoutConfig, so the preview and
// the delivered PDF paginate identically.

import {
  REPORT_PAPER_SIZES,
  type ReportLayoutConfig,
  type ReportPaperSize,
} from '@beaconhs/db/schema'
import type { ReportGroup, ReportSummaryItem } from './types'

export type { ReportLayoutConfig, ReportPaperSize }

export const DEFAULT_REPORT_LAYOUT: ReportLayoutConfig = {
  paperSize: 'letter',
  orientation: 'landscape',
  marginMm: 15,
}

export const REPORT_MARGIN_MM_MIN = 5
export const REPORT_MARGIN_MM_MAX = 30

/** Normalise a stored (or user-supplied) layout: whitelist paper/orientation,
 *  clamp margins, and fall back to the default landscape Letter document. */
export function resolveReportLayout(
  layout?: Partial<ReportLayoutConfig> | null,
): ReportLayoutConfig {
  const paperSize = REPORT_PAPER_SIZES.includes(layout?.paperSize as ReportPaperSize)
    ? (layout?.paperSize as ReportPaperSize)
    : DEFAULT_REPORT_LAYOUT.paperSize
  const orientation =
    layout?.orientation === 'portrait' || layout?.orientation === 'landscape'
      ? layout.orientation
      : DEFAULT_REPORT_LAYOUT.orientation
  const m = Number(layout?.marginMm)
  const marginMm = Number.isFinite(m)
    ? Math.min(Math.max(Math.round(m), REPORT_MARGIN_MM_MIN), REPORT_MARGIN_MM_MAX)
    : DEFAULT_REPORT_LAYOUT.marginMm
  return { paperSize, orientation, marginMm }
}

/** CSS @page size keyword per paper size. */
const PAGE_SIZE_NAME: Record<ReportPaperSize, string> = {
  letter: 'Letter',
  a4: 'A4',
  legal: 'Legal',
}

export const REPORT_PAPER_SIZE_LABELS: Record<ReportPaperSize, string> = PAGE_SIZE_NAME

export type ReportDocumentInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  reportName: string
  dateRangeLabel: string
  generatedAt: Date
  summary?: ReportSummaryItem[]
  groups: ReportGroup[]
}

/** Escape a string into a CSS `content:` literal. */
function cssString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The @page rule for a layout. With `opts.marginBoxes` (browser preview only)
 *  it adds running footer margin boxes with live page counters — the print
 *  path must NOT pass it (Puppeteer's footerTemplate draws those instead). */
export function buildReportPageCss(
  layout: ReportLayoutConfig,
  opts: { marginBoxes?: { footerLeft: string } } = {},
): string {
  const boxes = opts.marginBoxes
    ? `
  @bottom-left { content: ${cssString(opts.marginBoxes.footerLeft)}; font-size: 8px; color: #666; }
  @bottom-right { content: counter(page) " / " counter(pages); font-size: 8px; color: #666; }`
    : ''
  return `@page {
  size: ${PAGE_SIZE_NAME[layout.paperSize]} ${layout.orientation};
  margin: ${layout.marginMm}mm;${boxes}
}`
}

/** The document body fragment: scoped styles + cover header + summary band +
 *  one section per group. No <html> wrapper and no @page rule — callers pair
 *  it with buildReportPageCss() (preview) or the print document shell (PDF).
 *  Every element selector is scoped under .bhs-report-doc so the fragment can
 *  mount inside the app without restyling the page around it. */
export function renderReportDocumentBodyHtml(input: ReportDocumentInput): string {
  const primary = input.primaryColor ?? '#0f766e'

  const summaryCells = (input.summary ?? [])
    .map(
      (s) => `<div class="sum">
        <div class="sum-label">${escapeHtml(s.label)}</div>
        <div class="sum-value">${escapeHtml(String(s.value))}</div>
      </div>`,
    )
    .join('')

  const groupsHtml = input.groups
    .map((g) => {
      if (g.isEmpty || g.rows.length === 0) {
        return `<section class="group">
          <h2>${escapeHtml(g.title)}</h2>
          ${g.subtitle ? `<div class="subtitle">${escapeHtml(g.subtitle)}</div>` : ''}
          <div class="empty">No data.</div>
        </section>`
      }
      const head = g.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')
      const body = g.rows
        .map(
          (r) =>
            `<tr>${r
              .map((v) => `<td>${v === null || v === undefined ? '<em>—</em>' : escapeHtml(String(v))}</td>`)
              .join('')}</tr>`,
        )
        .join('')
      return `<section class="group">
        <h2>${escapeHtml(g.title)}</h2>
        ${g.subtitle ? `<div class="subtitle">${escapeHtml(g.subtitle)}</div>` : ''}
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </section>`
    })
    .join('')

  return `<style>
  .bhs-report-doc { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial; color: #111; font-size: 10pt; }
  .bhs-report-doc * { box-sizing: border-box; }
  .bhs-report-doc header.cover {
    border-bottom: 3px solid ${primary};
    padding: 0 0 10px;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .bhs-report-doc header.cover h1 { font-size: 18pt; margin: 0; color: #111; }
  .bhs-report-doc header.cover .meta { text-align: right; font-size: 9pt; color: #444; }
  .bhs-report-doc header.cover .meta div + div { margin-top: 2px; }
  .bhs-report-doc header.cover img.logo { max-height: 40px; margin-bottom: 6px; }
  .bhs-report-doc .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 8px;
    margin: 12px 0 18px;
  }
  .bhs-report-doc .sum {
    border: 1px solid #e5e7eb;
    border-left: 3px solid ${primary};
    padding: 8px 10px;
    border-radius: 3px;
    background: #fafafa;
    break-inside: avoid;
  }
  .bhs-report-doc .sum-label { color: #6b7280; font-size: 9pt; }
  .bhs-report-doc .sum-value { font-size: 14pt; font-weight: 600; color: #111; margin-top: 2px; }
  .bhs-report-doc section.group { margin: 14px 0; }
  .bhs-report-doc section.group h2 {
    font-size: 11.5pt;
    color: ${primary};
    margin: 8px 0 4px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 3px;
    break-after: avoid;
  }
  .bhs-report-doc section.group .subtitle { font-size: 9pt; color: #666; margin-bottom: 6px; break-after: avoid; }
  .bhs-report-doc table { width: 100%; max-width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  .bhs-report-doc thead { display: table-header-group; }
  .bhs-report-doc tr { break-inside: avoid; }
  .bhs-report-doc thead th {
    text-align: left;
    background: #f3f4f6;
    border-bottom: 1px solid #d1d5db;
    padding: 5px 8px;
    color: #374151;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .bhs-report-doc tbody td {
    padding: 5px 8px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
    overflow-wrap: anywhere;
  }
  .bhs-report-doc tbody td em { color: #999; font-style: italic; }
  .bhs-report-doc tbody tr:nth-child(even) { background: #fafafa; }
  .bhs-report-doc .empty { color: #999; font-style: italic; padding: 8px 0; }
  .bhs-report-doc img { max-width: 100%; height: auto; }
</style>
<div class="bhs-report-doc">
  <header class="cover">
    <div>
      ${input.tenantLogoUrl ? `<img class="logo" src="${escapeHtml(input.tenantLogoUrl)}" alt=""/>` : ''}
      <h1>${escapeHtml(input.reportName)}</h1>
    </div>
    <div class="meta">
      <div><strong>${escapeHtml(input.tenantName)}</strong></div>
      <div>${escapeHtml(input.dateRangeLabel)}</div>
      <div>Generated ${escapeHtml(input.generatedAt.toISOString().slice(0, 19).replace('T', ' '))}</div>
    </div>
  </header>
  ${summaryCells ? `<div class="summary">${summaryCells}</div>` : ''}
  ${groupsHtml}
</div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
