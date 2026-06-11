// Generic landscape report layout.
// Renders a header (tenant + report name + date range), optional summary stat
// cards, then one or more tables of data grouped by an arbitrary key.

import { escapeHtml } from '../util'

export type ReportRenderInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  reportName: string
  dateRangeLabel: string
  generatedAt: Date
  summary?: { label: string; value: string | number }[]
  groups: ReportGroup[]
}

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

export function renderReportHtml(input: ReportRenderInput): string {
  const primary = input.primaryColor ?? '#0f766e'

  const summaryCards = (input.summary ?? [])
    .map(
      (s) => `<div class="card">
        <div class="card-label">${escapeHtml(s.label)}</div>
        <div class="card-value">${escapeHtml(String(s.value))}</div>
      </div>`,
    )
    .join('')

  const groupsHtml = input.groups
    .map((g) => {
      if (g.isEmpty) {
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
              .map(
                (v) =>
                  `<td>${v === null || v === undefined ? '<em style="color:#999">—</em>' : escapeHtml(String(v))}</td>`,
              )
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

  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
  @page { size: Letter landscape; margin: 15mm; }
  :root { --primary: ${primary}; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial; color: #111; font-size: 10pt; margin: 0; }
  header.cover {
    border-bottom: 3px solid var(--primary);
    padding: 0 0 10px;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  header.cover h1 { font-size: 18pt; margin: 0; color: #111; }
  header.cover .meta {
    text-align: right;
    font-size: 9pt;
    color: #444;
  }
  header.cover .meta div + div { margin-top: 2px; }
  header.cover img.logo { max-height: 40px; margin-bottom: 6px; }
  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px;
    margin: 12px 0 18px;
  }
  .card {
    border: 1px solid #e5e7eb;
    border-left: 3px solid var(--primary);
    padding: 8px 10px;
    border-radius: 3px;
    background: #fafafa;
  }
  .card-label { color: #6b7280; font-size: 9pt; }
  .card-value { font-size: 14pt; font-weight: 600; color: #111; margin-top: 2px; }
  section.group { page-break-inside: avoid; margin: 14px 0; }
  section.group h2 {
    font-size: 11.5pt;
    color: var(--primary);
    margin: 8px 0 4px;
    border-bottom: 1px solid #ddd;
    padding-bottom: 3px;
  }
  section.group .subtitle { font-size: 9pt; color: #666; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  thead th {
    text-align: left;
    background: #f3f4f6;
    border-bottom: 1px solid #d1d5db;
    padding: 5px 8px;
    color: #374151;
    font-weight: 600;
  }
  tbody td {
    padding: 5px 8px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
  }
  tbody tr:nth-child(even) { background: #fafafa; }
  .empty { color: #999; font-style: italic; padding: 8px 0; }
</style></head>
<body>
  <header class="cover">
    <div>
      ${input.tenantLogoUrl ? `<img class="logo" src="${input.tenantLogoUrl}" alt=""/>` : ''}
      <h1>${escapeHtml(input.reportName)}</h1>
    </div>
    <div class="meta">
      <div><strong>${escapeHtml(input.tenantName)}</strong></div>
      <div>${escapeHtml(input.dateRangeLabel)}</div>
      <div>Generated ${escapeHtml(input.generatedAt.toISOString().slice(0, 19).replace('T', ' '))}</div>
    </div>
  </header>
  ${summaryCards ? `<div class="summary">${summaryCards}</div>` : ''}
  ${groupsHtml}
</body></html>`
}
