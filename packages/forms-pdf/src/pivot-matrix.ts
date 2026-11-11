import { buildReportDocumentFontCss, REPORT_DOCUMENT_FONT_FAMILY } from '@beaconhs/reports/document'
import { resolveHexColor } from './color'
import { escapeHtml, getBrowser, newPdfPage, setPdfContent } from './util'

type PivotMatrixColorToken = 'green' | 'amber' | 'red' | 'grey' | 'teal' | 'blue' | 'slate'

type PivotMatrixCell = {
  value: string
  token?: PivotMatrixColorToken
  backgroundColor?: string
}

export type PivotMatrixLegendItem = {
  label: string
  token: PivotMatrixColorToken
}

export type PivotMatrixSection = {
  title?: string
  rowHeaderLabel: string
  columns: string[]
  rows: {
    label: string
    cells: PivotMatrixCell[]
  }[]
  legend?: PivotMatrixLegendItem[]
  emptyMessage?: string
}

export type PivotMatrixDocumentInput = {
  tenantName: string
  tenantLogoUrl?: string | null
  primaryColor?: string | null
  reportName: string
  subtitle?: string | null
  truncatedNotice?: string | null
  summary?: { label: string; value: string | number }[]
  sections: PivotMatrixSection[]
  generatedAt?: Date
  timezone?: string
  locale?: string
  translate?: (value: string) => string
}

const MAX_SINGLE_BAND_COLUMNS = 14
const BAND_COLUMNS = 12

const SAFE_INLINE_BG =
  /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\))$/

function safeCssColor(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return SAFE_INLINE_BG.test(trimmed) ? trimmed : null
}

function renderLegendHtml(legend: PivotMatrixLegendItem[] | undefined): string {
  if (!legend || legend.length === 0) return ''
  return `<div class="pivot-legend">${legend
    .map(
      (item) =>
        `<span class="legend-pill cf-${escapeHtml(item.token)}">${escapeHtml(item.label)}</span>`,
    )
    .join('')}</div>`
}

function renderBandTableHtml(section: PivotMatrixSection, start: number, end: number): string {
  const columns = section.columns.slice(start, end)
  const colCount = columns.length
  const rowColWidth = colCount <= 8 ? 190 : colCount <= 12 ? 166 : 148
  const densityClass =
    colCount <= 10 ? 'density-roomy' : colCount <= 12 ? 'density-standard' : 'density-compact'
  const tableStyle = colCount <= 6 ? `width:${rowColWidth + colCount * 124}px;` : 'width:100%;'

  const colgroup = `<colgroup><col style="width:${rowColWidth}px"/>${columns
    .map(() => '<col/>')
    .join('')}</colgroup>`

  const thead = `<thead><tr><th scope="col" class="row-dim-head">${escapeHtml(
    section.rowHeaderLabel,
  )}</th>${columns
    .map((column) => `<th scope="col" class="col-dim-head">${escapeHtml(column)}</th>`)
    .join('')}</tr></thead>`

  const tbody = `<tbody>${section.rows
    .map((row) => {
      const cellsHtml = columns
        .map((_column, offset) => {
          const cell = row.cells[start + offset]
          const value = cell?.value ?? ''
          const tokenClass = cell?.token ? ` cf-${escapeHtml(cell.token)}` : ''
          const wrapClass = value.length > 0 && value.length <= 14 ? ' cell-nowrap' : ''
          const inlineBg = safeCssColor(cell?.backgroundColor)
          const styleAttr = inlineBg ? ` style="background-color:${escapeHtml(inlineBg)};"` : ''
          return `<td class="matrix-cell${tokenClass}${wrapClass}"${styleAttr}>${escapeHtml(
            value,
          )}</td>`
        })
        .join('')
      return `<tr><th scope="row" class="row-dim-cell">${escapeHtml(
        row.label,
      )}</th>${cellsHtml}</tr>`
    })
    .join('')}</tbody>`

  return `<div class="matrix-frame"><table class="pivot-grid ${densityClass}" style="${tableStyle}">${colgroup}${thead}${tbody}</table></div>`
}

export function buildPivotMatrixDocumentHtml(input: PivotMatrixDocumentInput): string {
  const t = input.translate ?? ((v: string) => v)
  const accent = resolveHexColor(input.primaryColor, '#0d9488')
  const summaryHtml =
    input.summary && input.summary.length > 0
      ? `<div class="summary-pills">${input.summary
          .map(
            (item) =>
              `<span class="summary-pill"><span class="summary-label">${escapeHtml(
                item.label,
              )}:</span> <strong>${escapeHtml(String(item.value))}</strong></span>`,
          )
          .join('')}</div>`
      : ''

  const truncatedHtml = input.truncatedNotice
    ? `<div class="truncated-banner">${escapeHtml(input.truncatedNotice)}</div>`
    : ''

  const firstLegend = input.sections.find((s) => s.legend && s.legend.length > 0)?.legend

  const mainHeaderHtml = `<header class="doc-header">
    <div class="doc-accent" style="background:${escapeHtml(accent)};"></div>
    <div class="doc-header-row">
      <div class="doc-brand">
        ${
          input.tenantLogoUrl
            ? `<img class="doc-logo" src="${escapeHtml(input.tenantLogoUrl)}" alt="${escapeHtml(
                input.tenantName,
              )}" />`
            : ''
        }
        <div class="doc-eyebrow">${escapeHtml(input.tenantName)}</div>
        <h1 class="doc-title">${escapeHtml(input.reportName)}</h1>
        ${input.subtitle ? `<p class="doc-subtitle">${escapeHtml(input.subtitle)}</p>` : ''}
      </div>
      <div class="doc-meta">
        ${summaryHtml}
        ${renderLegendHtml(firstLegend)}
      </div>
    </div>
    ${truncatedHtml}
  </header>`

  const blocks: string[] = []
  let bandIndex = 0

  const sections =
    input.sections.length > 0
      ? input.sections
      : [
          {
            rowHeaderLabel: '',
            columns: [],
            rows: [],
            emptyMessage: t('No data for these filters.'),
          },
        ]

  for (const section of sections) {
    if (section.columns.length === 0 || section.rows.length === 0) {
      const breakClass = bandIndex > 0 ? ' pivot-band-break' : ''
      const head =
        bandIndex === 0
          ? mainHeaderHtml
          : `<div class="cont-header"><div class="cont-left"><span class="cont-eyebrow">${escapeHtml(
              input.tenantName,
            )}</span><span class="cont-title">${escapeHtml(input.reportName)}</span>${
              section.title ? `<span class="band-pill">${escapeHtml(section.title)}</span>` : ''
            }</div>${renderLegendHtml(section.legend ?? firstLegend)}</div>`
      blocks.push(
        `<section class="pivot-band${breakClass}">${head}<div class="empty-state">${escapeHtml(
          section.emptyMessage ?? t('No data for these filters.'),
        )}</div></section>`,
      )
      bandIndex += 1
      continue
    }

    const step =
      section.columns.length <= MAX_SINGLE_BAND_COLUMNS ? section.columns.length : BAND_COLUMNS
    const multiBand = section.columns.length > step

    for (let start = 0; start < section.columns.length; start += step) {
      const end = Math.min(section.columns.length, start + step)
      const rangeText = multiBand
        ? `${t('Columns')} ${(start + 1).toLocaleString()}–${end.toLocaleString()} ${t('of')} ${section.columns.length.toLocaleString()}`
        : ''
      const metaLabel = [section.title, rangeText].filter(Boolean).join(' · ')
      const breakClass = bandIndex > 0 ? ' pivot-band-break' : ''

      if (bandIndex === 0) {
        const subBar = metaLabel
          ? `<div class="band-subbar"><span class="band-pill">${escapeHtml(metaLabel)}</span></div>`
          : ''
        blocks.push(
          `<section class="pivot-band">${mainHeaderHtml}${subBar}${renderBandTableHtml(
            section,
            start,
            end,
          )}</section>`,
        )
      } else {
        blocks.push(
          `<section class="pivot-band${breakClass}">
            <div class="cont-header">
              <div class="cont-left">
                <span class="cont-eyebrow">${escapeHtml(input.tenantName)}</span>
                <span class="cont-title">${escapeHtml(input.reportName)}</span>
                ${metaLabel ? `<span class="band-pill">${escapeHtml(metaLabel)}</span>` : ''}
              </div>
              ${renderLegendHtml(section.legend ?? firstLegend)}
            </div>
            ${renderBandTableHtml(section, start, end)}
          </section>`,
        )
      }
      bandIndex += 1
    }
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(input.reportName)}</title>
  <style>
    ${buildReportDocumentFontCss()}
    @page {
      size: 11in 8.5in;
      margin: 8mm 8mm 12mm 8mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    html, body {
      margin: 0;
      padding: 0;
      font-family: ${REPORT_DOCUMENT_FONT_FAMILY};
      color: #0f172a;
      background: #ffffff;
    }
    .pivot-band-break {
      break-before: page;
      page-break-before: always;
    }
    .doc-header {
      margin-bottom: 8px;
    }
    .doc-accent {
      height: 3px;
      width: 100%;
      border-radius: 2px;
      margin-bottom: 8px;
    }
    .doc-header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      padding-bottom: 8px;
      border-bottom: 1px solid #e2e8f0;
    }
    .doc-brand {
      min-width: 0;
    }
    .doc-logo {
      display: block;
      max-height: 24px;
      max-width: 140px;
      object-fit: contain;
      margin-bottom: 4px;
    }
    .doc-eyebrow {
      font-size: 8.5px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #64748b;
      margin-bottom: 2px;
    }
    .doc-title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      line-height: 1.2;
      letter-spacing: -0.015em;
      color: #0f172a;
    }
    .doc-subtitle {
      margin: 2px 0 0;
      font-size: 9.5px;
      color: #64748b;
    }
    .doc-meta {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      flex-shrink: 0;
    }
    .summary-pills, .pivot-legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: 5px;
    }
    .summary-pill {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 2px 7px;
      border-radius: 999px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      font-size: 8.5px;
      color: #475569;
      font-variant-numeric: tabular-nums;
    }
    .summary-pill strong {
      color: #0f172a;
      font-weight: 600;
    }
    .legend-pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      font-size: 8.5px;
      font-weight: 600;
      line-height: 1.3;
    }
    .truncated-banner {
      margin-top: 6px;
      padding: 5px 8px;
      border-radius: 5px;
      background: #fffbeb;
      border: 1px solid #fde68a;
      color: #92400e;
      font-size: 8.5px;
    }
    .band-subbar {
      margin: 0 0 6px;
    }
    .band-pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 4px;
      background: #f1f5f9;
      color: #334155;
      font-size: 8.5px;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
    }
    .cont-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding-bottom: 6px;
      margin-bottom: 6px;
      border-bottom: 1px solid #e2e8f0;
    }
    .cont-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .cont-eyebrow {
      font-size: 8.5px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }
    .cont-title {
      font-size: 11px;
      font-weight: 600;
      color: #0f172a;
    }
    .matrix-frame {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      overflow: hidden;
      display: inline-block;
      max-width: 100%;
      width: 100%;
    }
    .pivot-grid {
      border-collapse: collapse;
      table-layout: fixed;
    }
    .pivot-grid thead {
      display: table-header-group;
    }
    .pivot-grid tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .row-dim-head {
      background: #f8fafc;
      color: #334155;
      font-weight: 600;
      text-align: left;
      vertical-align: bottom;
      border-bottom: 1.5px solid #cbd5e1;
      border-right: 1.5px solid #cbd5e1;
      overflow-wrap: break-word;
    }
    .col-dim-head {
      background: #f8fafc;
      color: #334155;
      font-weight: 600;
      text-align: center;
      vertical-align: bottom;
      line-height: 1.2;
      border-bottom: 1.5px solid #cbd5e1;
      border-left: 1px solid #e2e8f0;
      overflow-wrap: break-word;
      word-break: break-word;
    }
    .row-dim-cell {
      background: #ffffff;
      color: #1e293b;
      font-weight: 500;
      text-align: left;
      vertical-align: middle;
      line-height: 1.25;
      border-bottom: 1px solid #e2e8f0;
      border-right: 1.5px solid #cbd5e1;
      overflow-wrap: break-word;
    }
    .matrix-cell {
      background: #ffffff;
      color: #475569;
      font-weight: 500;
      text-align: center;
      vertical-align: middle;
      line-height: 1.2;
      font-variant-numeric: tabular-nums;
      border-bottom: 1px solid #e2e8f0;
      border-left: 1px solid #e2e8f0;
      overflow-wrap: break-word;
    }
    .pivot-grid tbody tr:last-child th,
    .pivot-grid tbody tr:last-child td {
      border-bottom: none;
    }
    .cell-nowrap {
      white-space: nowrap;
    }
    .density-roomy .row-dim-head,
    .density-roomy .row-dim-cell {
      font-size: 8.5px;
      padding: 5px 8px;
    }
    .density-roomy .col-dim-head {
      font-size: 8.5px;
      padding: 6px 5px;
    }
    .density-roomy .matrix-cell {
      font-size: 8.5px;
      padding: 5px 4px;
    }
    .density-standard .row-dim-head,
    .density-standard .row-dim-cell {
      font-size: 8px;
      padding: 4.5px 7px;
    }
    .density-standard .col-dim-head {
      font-size: 8px;
      padding: 5.5px 4px;
    }
    .density-standard .matrix-cell {
      font-size: 8px;
      padding: 4.5px 3.5px;
    }
    .density-compact .row-dim-head,
    .density-compact .row-dim-cell {
      font-size: 7.5px;
      padding: 4px 6px;
    }
    .density-compact .col-dim-head {
      font-size: 7.5px;
      padding: 5px 3px;
    }
    .density-compact .matrix-cell {
      font-size: 7.5px;
      padding: 4px 2.5px;
    }
    .cf-green {
      background-color: #dcfce7;
      color: #166534;
      font-weight: 600;
    }
    .cf-amber {
      background-color: #fef3c7;
      color: #92400e;
      font-weight: 600;
    }
    .cf-red {
      background-color: #fee2e2;
      color: #991b1b;
      font-weight: 600;
    }
    .cf-teal {
      background-color: #ccfbf1;
      color: #115e59;
      font-weight: 600;
    }
    .cf-blue {
      background-color: #dbeafe;
      color: #1e40af;
      font-weight: 600;
    }
    .cf-slate {
      background-color: #f1f5f9;
      color: #334155;
      font-weight: 500;
    }
    .cf-grey {
      background-color: #ffffff;
      color: #94a3b8;
    }
    .legend-pill.cf-green {
      border: 1px solid #bbf7d0;
    }
    .legend-pill.cf-amber {
      border: 1px solid #fde68a;
    }
    .legend-pill.cf-red {
      border: 1px solid #fecaca;
    }
    .legend-pill.cf-teal {
      border: 1px solid #99f6e4;
    }
    .legend-pill.cf-blue {
      border: 1px solid #bfdbfe;
    }
    .legend-pill.cf-slate,
    .legend-pill.cf-grey {
      border: 1px solid #cbd5e1;
    }
    .empty-state {
      border: 1px dashed #cbd5e1;
      border-radius: 6px;
      padding: 24px 16px;
      text-align: center;
      font-size: 10px;
      color: #64748b;
    }
  </style>
</head>
<body>${blocks.join('')}</body>
</html>`
}

export async function renderPivotMatrixPdf(input: PivotMatrixDocumentInput): Promise<Buffer> {
  const html = buildPivotMatrixDocumentHtml(input)
  const printedAt = new Intl.DateTimeFormat(input.locale ?? 'en-CA', {
    timeZone: input.timezone ?? 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  }).format(input.generatedAt ?? new Date())
  const printedLabel = input.translate?.('Printed') ?? 'Printed'
  const b = await getBrowser()
  const page = await newPdfPage(b)
  try {
    await setPdfContent(page, html, { waitForFonts: true })
    const pdf = await page.pdf({
      width: '11in',
      height: '8.5in',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `<style>${buildReportDocumentFontCss()}</style>
        <div style='font-family:${REPORT_DOCUMENT_FONT_FAMILY};font-size:8px;color:#64748b;width:100%;padding:0 8mm;display:flex;justify-content:space-between;'>
          <span>${escapeHtml(printedLabel)} ${escapeHtml(printedAt)}</span>
          <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>`,
      margin: { top: '8mm', bottom: '12mm', left: '8mm', right: '8mm' },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}
