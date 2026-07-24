// Server-side PDF printing helpers.
//
// Renders run in a worker container with Chromium installed. Record PDFs are
// produced from tenant-authored PDF DOCUMENT templates (merged HTML printed by
// renderHtmlDocumentPdf) with the generic record summary as the only fallback;
// this package also owns the credential (certificate + wallet), design-studio
// and scheduled-report printers.

import {
  renderDesignDocumentHtml,
  renderDesignDocumentsHtml,
  type CredentialDesignData,
  type DesignDocument,
  type DesignDocumentData,
  type EquipmentLabelDesignData,
} from '@beaconhs/design-studio'
import {
  buildReportDocumentCss,
  buildReportPageCss,
  renderReportDocumentBodyHtml,
  resolveReportLayout,
  type ReportDocumentInput,
  type ReportLayoutConfig,
} from '@beaconhs/reports/document'
import { renderCertificateHtml, type CertificateRenderInput } from './templates/certificate'
import { renderWalletHtml, type WalletRenderInput } from './templates/wallet'
import type {
  CredentialDesignFormat,
  CredentialDesignOptions,
  CredentialDesignTemplateId,
  CredentialDesignTypeface,
} from './templates/credential-theme'
import { escapeHtml, getBrowser as browser, newPdfPage, setPdfContent } from './util'

export type {
  CertificateRenderInput,
  WalletRenderInput,
  CredentialDesignFormat,
  CredentialDesignOptions,
  CredentialDesignTemplateId,
  CredentialDesignTypeface,
  CredentialDesignData,
  DesignDocument,
  DesignDocumentData,
  EquipmentLabelDesignData,
}

export async function renderDesignDocumentPdf(input: {
  document: DesignDocument
  data: DesignDocumentData
  title?: string
}): Promise<Buffer> {
  const html = renderDesignDocumentHtml(input.document, input.data, { title: input.title })
  return printDesignHtmlPdf(html, input.document.artboards[0])
}

/** Render each design artboard as a full-bleed PNG for physical-card bridges. */
export async function renderDesignDocumentPngs(input: {
  document: DesignDocument
  data: DesignDocumentData
  dpi?: number
}): Promise<Buffer[]> {
  const dpi = Math.max(72, Math.min(600, Math.round(input.dpi ?? input.document.dpi ?? 300)))
  const b = await browser()
  const rendered: Buffer[] = []

  for (const artboard of input.document.artboards) {
    const page = await newPdfPage(b)
    try {
      const width = Math.max(1, Math.ceil(artboard.width * 96))
      const height = Math.max(1, Math.ceil(artboard.height * 96))
      await page.setViewport({ width, height, deviceScaleFactor: dpi / 96 })
      const html = renderDesignDocumentHtml(input.document, input.data, {
        artboardId: artboard.id,
        title: input.document.name,
      })
      await setPdfContent(page, html, { waitForFonts: true })
      const png = await page.screenshot({
        type: 'png',
        clip: { x: 0, y: 0, width, height },
        captureBeyondViewport: false,
      })
      rendered.push(Buffer.from(png))
    } finally {
      await page.close()
    }
  }
  return rendered
}

/**
 * N design documents printed back-to-back as ONE multi-page PDF — one page per
 * artboard, each rendered against its own data (bulk label runs). All pages
 * print at the FIRST artboard's physical size, so callers pass a uniform run.
 */
export async function renderDesignDocumentsPdf(
  pages: { document: DesignDocument; data: DesignDocumentData }[],
  options: { title?: string } = {},
): Promise<Buffer> {
  if (pages.length === 0) throw new Error('renderDesignDocumentsPdf: no pages to render')
  const html = renderDesignDocumentsHtml(pages, { title: options.title })
  return printDesignHtmlPdf(html, pages[0]?.document.artboards[0])
}

async function printDesignHtmlPdf(
  html: string,
  first: { width: number; height: number } | undefined,
): Promise<Buffer> {
  const b = await browser()
  const page = await newPdfPage(b)
  try {
    await setPdfContent(page, html, { waitForFonts: true })
    const pdf = await page.pdf({
      width: first ? `${first.width}in` : '11in',
      height: first ? `${first.height}in` : '8.5in',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// --- Certificate and on-demand wallet-card PDFs --------------------------

export async function renderCertificatePagePdf(input: CertificateRenderInput): Promise<Buffer> {
  const body = renderCertificateHtml(input)
  // Certificate template carries its own @page rule + 11×8.5in landscape
  // wrapper, so we render with zero default margins and let CSS control
  // layout. The embedded @font-face data URLs must finish decoding before
  // print, hence the explicit document.fonts.ready wait.
  const html = wrapDocument(body, 'Certificate')
  const b = await browser()
  const page = await newPdfPage(b)
  try {
    await setPdfContent(page, html, { waitForFonts: true })
    const portrait = input.design?.format === 'letter-portrait'
    const pdf = await page.pdf({
      width: portrait ? '8.5in' : '11in',
      height: portrait ? '11in' : '8.5in',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

export async function renderWalletCardPdf(input: WalletRenderInput): Promise<Buffer> {
  const body = renderWalletHtml(input)
  const html = wrapDocument(body, 'Wallet Card')
  const b = await browser()
  const page = await newPdfPage(b)
  try {
    await setPdfContent(page, html, { waitForFonts: true })
    // CR80 credit-card size; two pages (front + back).
    const pdf = await page.pdf({
      width: '3.375in',
      height: '2.125in',
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

function wrapDocument(body: string, title: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"/><title>${title.replace(/[<>]/g, '')}</title></head>
<body>${body}</body></html>`
}

// --- Scheduled-report PDF -------------------------------------------------
//
// Prints the SAME document body and CSS as the in-app paper preview, on the
// definition's configured paper (size/orientation/margins). There is no
// PDF-only header/footer chrome, which would introduce a second font and layout.

export async function renderReportPdf(
  input: ReportDocumentInput & { layout?: Partial<ReportLayoutConfig> | null },
): Promise<Buffer> {
  const layout = resolveReportLayout(input.layout)
  const html = `<!doctype html>
<html><head><meta charset="utf-8"/><title>${escapeHtml(input.reportName)}</title>
<style>${buildReportPageCss(layout)} body { margin: 0; } ${buildReportDocumentCss(input.primaryColor, layout.density)}</style>
</head><body>${renderReportDocumentBodyHtml({
    ...input,
    summary: layout.showSummary ? input.summary : undefined,
  })}</body></html>`
  const m = `${layout.marginMm}mm`
  const b = await browser()
  const page = await newPdfPage(b)
  try {
    await setPdfContent(page, html, { waitForFonts: true })
    const pdf = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margin: { top: m, bottom: m, left: m, right: m },
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// --- Generic letterhead body renderer -------------------------------------
//
// Used by the record-summary fallback. The template produces a self-contained
// body fragment (style + DOM) which we wrap in
// <html><head><title>...</head><body>...</body></html> and print on
// Letter-sized pages with a small footer (page n / total).

async function printLetterheadPdf(args: {
  body: string
  title: string
  footerLeft: string
  footerRight?: string
  pageSize?: 'Letter' | 'A4'
  headerHtml?: string
  showFooter?: boolean
  margin?: { top: string; bottom: string; left: string; right: string }
}): Promise<Buffer> {
  const html = wrapDocument(args.body, args.title)
  const b = await browser()
  const page = await newPdfPage(b)
  try {
    await setPdfContent(page, html)
    const showFooter = args.showFooter !== false
    const pdf = await page.pdf({
      format: args.pageSize ?? 'Letter',
      printBackground: true,
      margin: args.margin ?? { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: args.headerHtml ?? `<div></div>`,
      footerTemplate: showFooter
        ? `<div style="font-size:8px;width:100%;padding:0 12mm;display:flex;justify-content:space-between;color:#666;">
        <span>${escapeHtml(args.footerLeft)}</span>
        <span>${args.footerRight ? escapeHtml(args.footerRight) + ' · ' : ''}<span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`
        : `<div></div>`,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// --- Generic tenant PDF DOCUMENT template ---------------------------------
//
// Prints already-merged HTML (no letterhead chrome) on the chosen paper at the
// chosen orientation/margins, with the tenant's own running header/footer.
// `{{page}}`/`{{pages}}` in the header/footer become Puppeteer's live page
// counters — so the @page page numbers from the Paged.js preview match here.
export async function renderHtmlDocumentPdf(input: {
  bodyHtml: string
  paperSize: 'letter' | 'a4' | 'legal'
  orientation: 'portrait' | 'landscape'
  marginMm: number
  headerHtml?: string | null
  footerHtml?: string | null
}): Promise<Buffer> {
  const formatMap = { letter: 'Letter', a4: 'A4', legal: 'Legal' } as const
  const m = `${Math.max(0, input.marginMm)}mm`
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;} body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;}
    table{page-break-inside:auto;} tr{page-break-inside:avoid;}
  </style></head><body>${input.bodyHtml}</body></html>`
  const pageCounters = (s?: string | null): string =>
    s
      ? s
          .replace(/\{\{\s*page\s*\}\}/g, '<span class="pageNumber"></span>')
          .replace(/\{\{\s*pages\s*\}\}/g, '<span class="totalPages"></span>')
      : ''
  const headerTemplate = input.headerHtml
    ? `<div style="font-size:8px;width:100%;padding:0 ${m};color:#64748b;">${pageCounters(input.headerHtml)}</div>`
    : `<div></div>`
  const footerTemplate = input.footerHtml
    ? `<div style="font-size:8px;width:100%;padding:0 ${m};color:#94a3b8;text-align:center;">${pageCounters(input.footerHtml)}</div>`
    : `<div></div>`
  const b = await browser()
  const page = await newPdfPage(b)
  try {
    await setPdfContent(page, html)
    const pdf = await page.pdf({
      format: formatMap[input.paperSize] ?? 'Letter',
      landscape: input.orientation === 'landscape',
      printBackground: true,
      margin: { top: m, bottom: m, left: m, right: m },
      displayHeaderFooter: Boolean(input.headerHtml || input.footerHtml),
      headerTemplate,
      footerTemplate,
    })
    return Buffer.from(pdf)
  } finally {
    await page.close()
  }
}

// --- Generic record summary PDF -------------------------------------------
// A branded key-value table built from a flow's field-map. The ONLY fallback
// for record PDFs when no tenant PDF document template is assigned.

export type RecordSummaryRenderInput = {
  tenantName: string
  heading: string
  reference?: string | null
  subtitle?: string | null
  fields: { label: string; value: string }[]
  // Row collections (inspection criteria, log entries, attendees, …) printed
  // as sectioned tables after the field summary.
  sections?: {
    label: string
    columns: { key: string; label: string }[]
    rows: Record<string, string>[]
    moreRows?: number
  }[]
  // Record photos printed as an image grid.
  photos?: { url: string; caption?: string }[]
}

export async function renderRecordSummaryPdf(input: RecordSummaryRenderInput): Promise<Buffer> {
  return printLetterheadPdf({
    body: renderRecordSummaryHtml(input),
    title: input.heading,
    footerLeft: input.tenantName,
    footerRight: input.reference ?? undefined,
  })
}

function renderRecordSummaryHtml(input: RecordSummaryRenderInput): string {
  const rows =
    input.fields.length === 0
      ? `<tr><td style="padding:8px 10px;border:1px solid #e2e8f0;color:#94a3b8;">No details captured.</td></tr>`
      : input.fields
          .map(
            (f) => `<tr>
              <th style="text-align:left;padding:7px 10px;background:#f1f5f9;border:1px solid #e2e8f0;width:34%;font-weight:600;vertical-align:top;color:#334155;">${escapeHtml(
                f.label,
              )}</th>
              <td style="padding:7px 10px;border:1px solid #e2e8f0;vertical-align:top;white-space:pre-wrap;color:#0f172a;">${escapeHtml(
                f.value,
              )}</td>
            </tr>`,
          )
          .join('')
  const sections = (input.sections ?? [])
    .map((s) => {
      const head = s.columns
        .map(
          (c) =>
            `<th style="text-align:left;padding:6px 8px;background:#f1f5f9;border:1px solid #e2e8f0;font-weight:600;color:#334155;">${escapeHtml(c.label)}</th>`,
        )
        .join('')
      const body = s.rows
        .map(
          (r) =>
            `<tr>${s.columns
              .map(
                (c) =>
                  `<td style="padding:6px 8px;border:1px solid #e2e8f0;vertical-align:top;white-space:pre-wrap;color:#0f172a;">${escapeHtml(r[c.key] ?? '')}</td>`,
              )
              .join('')}</tr>`,
        )
        .join('')
      const more = s.moreRows
        ? `<p style="margin:4px 0 0;font-size:11px;color:#64748b;">+ ${s.moreRows} more row${s.moreRows === 1 ? '' : 's'} not shown.</p>`
        : ''
      return `
        <h2 style="font-size:14px;margin:18px 0 6px;color:#0f172a;">${escapeHtml(s.label)}</h2>
        <table style="width:100%;border-collapse:collapse;font-size:11px;"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
        ${more}`
    })
    .join('')
  const photos =
    input.photos && input.photos.length > 0
      ? `
        <h2 style="font-size:14px;margin:18px 0 6px;color:#0f172a;">Photos</h2>
        <div>${input.photos
          .map(
            (p) => `
          <div style="display:inline-block;vertical-align:top;width:46%;margin:0 2% 12px 0;">
            <img src="${escapeHtml(p.url)}" style="width:100%;border:1px solid #e2e8f0;border-radius:4px;" />
            ${p.caption ? `<div style="font-size:10px;color:#475569;margin-top:2px;">${escapeHtml(p.caption)}</div>` : ''}
          </div>`,
          )
          .join('')}</div>`
      : ''
  return `
    <h1 style="font-size:19px;margin:0 0 4px;color:#0f172a;">${escapeHtml(input.heading)}</h1>
    ${input.subtitle ? `<p style="margin:0 0 2px;font-size:13px;color:#475569;">${escapeHtml(input.subtitle)}</p>` : ''}
    ${
      input.reference
        ? `<p style="margin:0 0 16px;font-size:12px;color:#64748b;">Reference: ${escapeHtml(input.reference)}</p>`
        : '<div style="height:10px"></div>'
    }
    <table style="width:100%;border-collapse:collapse;font-size:12px;">${rows}</table>
    ${sections}
    ${photos}
  `
}
