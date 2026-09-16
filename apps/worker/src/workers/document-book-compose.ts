import { composePdf, pageGeometry, type ComposePart } from '@beaconhs/office'
import type { DocumentBookPrintSettings } from '@beaconhs/db/schema'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'

// Assembling a document book.
//
// The book is built from PDFs that already exist: authored documents rendered
// from their DOCX master, plus uploaded files and scans. Those arrive in
// whatever geometry their producer chose — LibreOffice emits A4, office
// copiers emit a rotated Letter box — so simply concatenating them produces a
// PDF that changes paper size as you read it and can carry no page numbering
// across the seams. Everything here is imposed onto one geometry instead, and
// the furniture (cover, contents, controlled-document sheets, footer) is
// generated around it.

// Not exported: callers build these structurally as part of ComposeBookInput,
// so exporting the name only creates an unused public symbol.
type BookEntry = {
  title: string
  key: string
  version: number
  /** The published PDF for this document version. */
  pdf: Buffer
  pageCount: number
  category?: string | null
  type?: string | null
  issuedAt?: Date | null
  revisedAt?: Date | null
  approvedBy?: string | null
}

export type ComposeBookInput = {
  title: string
  description?: string | null
  tenantName: string
  logoUrl?: string | null
  accentColor?: string | null
  publishedAt?: Date | null
  settings?: DocumentBookPrintSettings | null
  entries: BookEntry[]
  /** IANA zone for the printed-at stamp and document dates. */
  timeZone: string
  now?: Date
}

const DEFAULTS = {
  paperSize: 'letter',
  orientation: 'portrait',
  contentMarginMm: 0,
  coverPage: true,
  tableOfContents: true,
  documentHeaders: true,
  // The control block rides on the document's first page. Giving it a sheet of
  // its own doubled the page count of a book whose members are mostly one page.
  documentHeadersOnOwnPage: false,
  footer: true,
  documentPageBreaks: true,
} as const satisfies Required<DocumentBookPrintSettings>

const PT_PER_MM = 72 / 25.4
/** Band reserved for the control block when it rides on the document. */
const CONTROL_BAND_PT = 132

export function resolveBookPrintSettings(
  settings: DocumentBookPrintSettings | null | undefined,
): Required<DocumentBookPrintSettings> {
  return { ...DEFAULTS, ...(settings ?? {}) }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatMonthYear(value: Date | null | undefined, timeZone: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-CA', { month: 'long', year: 'numeric', timeZone }).format(
    value,
  )
}

function formatStamp(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(value)
}

/**
 * The controlled-document block: category, issue and revision dates, approver
 * and version. Reproduces the control sheet the legacy manual printed above
 * every policy — auditors look for exactly these fields.
 *
 * It is a sheet of its own rather than an overlay because the document below it
 * is an already-rendered PDF whose content cannot be pushed down to make room.
 */
function controlSheetHtml(
  entry: BookEntry,
  accent: string,
  timeZone: string,
  ownPage: boolean,
): string {
  const pad = ownPage ? '6px 10px' : '3px 8px'
  const cell = `border:1px solid #0f172a;padding:${pad};font-size:${ownPage ? 11 : 9}px;vertical-align:middle;`
  const label = `${cell}width:22%;letter-spacing:.06em;text-transform:uppercase;color:#334155;`
  const value = `${cell}width:36%;`
  return `
    <div style="padding-top:${ownPage ? 48 : 0}px">
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <colgroup><col style="width:42%"><col style="width:22%"><col style="width:36%"></colgroup>
        <tbody>
          <tr>
            <td style="${cell}text-transform:uppercase;letter-spacing:.06em;color:#334155;font-size:11px;">${escapeHtml(entry.category ?? '')}</td>
            <td style="${label}">Issue date</td>
            <td style="${value}">${escapeHtml(formatMonthYear(entry.issuedAt, timeZone))}</td>
          </tr>
          <tr>
            <td rowspan="4" style="${cell}background:${accent};color:#fff;font-size:${ownPage ? 21 : 15}px;font-weight:700;line-height:1.2;">${escapeHtml(entry.title)}</td>
            <td style="${label}">Revision date</td>
            <td style="${value}">${escapeHtml(formatMonthYear(entry.revisedAt, timeZone))}</td>
          </tr>
          <tr>
            <td style="${label}">Approved by</td>
            <td style="${value}">${escapeHtml(entry.approvedBy ?? '—')}</td>
          </tr>
          <tr>
            <td style="${label}">Version</td>
            <td style="${value}">${entry.version}</td>
          </tr>
          <tr>
            <td colspan="2" style="${cell}text-align:center;text-transform:uppercase;letter-spacing:.06em;color:#334155;">${escapeHtml(entry.type ?? '')}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin-top:${ownPage ? 14 : 5}px;font-size:${ownPage ? 10 : 8}px;color:#64748b;letter-spacing:.04em;">${escapeHtml(entry.key)}</p>
    </div>`
}

function coverHtml(input: ComposeBookInput, accent: string): string {
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" alt="" style="max-height:150px;max-width:70%;object-fit:contain" />`
    : ''
  const issued = input.publishedAt
    ? `<div style="margin-top:6px;font-size:12px;color:#64748b">Issued ${escapeHtml(formatMonthYear(input.publishedAt, input.timeZone))}</div>`
    : ''
  // Centred on the sheet with a generous rule under the title — a title page
  // should look deliberate, not like the first page of the contents.
  //
  // The height is in `vh`, not `%`: a percentage resolves against the body,
  // which has no height of its own, so it collapses and the block drifts to
  // the top of the page instead of centring.
  return `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 12%">
      <div style="margin-bottom:56px">${logo}</div>
      <div style="font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:#64748b">${escapeHtml(input.tenantName)}</div>
      <h1 style="margin:14px 0 0;font-size:40px;line-height:1.15;font-weight:700;color:#0f172a">${escapeHtml(input.title)}</h1>
      <div style="width:120px;height:3px;background:${accent};margin:26px auto"></div>
      ${input.description ? `<p style="margin:0;font-size:13px;line-height:1.6;color:#334155;max-width:80%">${escapeHtml(input.description)}</p>` : ''}
      ${issued}
    </div>`
}

function tableOfContentsHtml(
  rows: { title: string; key: string; version: number; page: number }[],
  accent: string,
): string {
  const items = rows
    .map(
      (row) => `
      <tr>
        <td style="padding:7px 0;font-size:12px;color:#0f172a;">
          ${escapeHtml(row.title)}
          <span style="color:#94a3b8"> · v${row.version}</span>
        </td>
        <td style="padding:7px 0;font-size:10px;color:#94a3b8;white-space:nowrap;text-align:right;padding-right:14px">${escapeHtml(row.key)}</td>
        <td style="padding:7px 0;font-size:12px;color:#0f172a;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${row.page}</td>
      </tr>`,
    )
    .join('')
  return `
    <div>
      <h2 style="margin:0;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#334155">Contents</h2>
      <div style="width:72px;height:3px;background:${accent};margin:12px 0 18px"></div>
      <table style="width:100%;border-collapse:collapse;table-layout:auto">
        <tbody>${items}</tbody>
      </table>
    </div>`
}

/**
 * Compose the finished book.
 *
 * Page numbers in the contents are real: the body is measured before the
 * contents are rendered, and because the cover and contents are unnumbered the
 * body always starts at printed page 1 — so the numbers do not depend on how
 * long the contents runs to, and one pass settles it.
 */
export async function composeDocumentBook(input: ComposeBookInput): Promise<Buffer> {
  const settings = resolveBookPrintSettings(input.settings)
  const accent = input.accentColor?.trim() || '#0f172a'
  const now = input.now ?? new Date()
  const geometry = pageGeometry(settings.paperSize, settings.orientation)
  const paper = { paperSize: settings.paperSize, orientation: settings.orientation } as const

  // Control sheets are part of the body, so they must exist before the contents
  // can know where anything starts.
  //
  // Rendered as ONE multi-page document rather than one render per document.
  // Each sheet is a few hundred bytes of markup, but a browser render costs
  // ~60ms of startup regardless — on a 196-document manual that was ~11s of a
  // ~12s render, dwarfing every other phase combined. One render, then each
  // sheet is sliced out by page index at composition time.
  const controlSheetsPdf =
    settings.documentHeaders && input.entries.length > 0
      ? await renderHtmlDocumentPdf({
          ...paper,
          marginMm: settings.documentHeadersOnOwnPage ? 18 : 6,
          bodyHtml: input.entries
            .map(
              (entry, i) =>
                `<div style="${i > 0 ? 'page-break-before:always;' : ''}">${controlSheetHtml(entry, accent, input.timeZone, settings.documentHeadersOnOwnPage)}</div>`,
            )
            .join(''),
        })
      : null

  // A block that rides on the document adds no page of its own, so it does not
  // move where anything starts.
  const ownPage = Boolean(controlSheetsPdf) && settings.documentHeadersOnOwnPage
  const bodyLengths = input.entries.map((entry) => (ownPage ? 1 : 0) + Math.max(1, entry.pageCount))

  // Printed numbers start at the first BODY page: the cover and the contents
  // are unnumbered, exactly as a reader would count. That also means the
  // numbers do not depend on how many pages the contents itself runs to, so
  // there is no chicken-and-egg to resolve — offsetting by the front matter
  // simply made every entry wrong by the length of the contents.
  //
  // An entry points at the document's control sheet, which is that document's
  // first page in the book.
  let cursor = 1
  const tocRows = input.entries.map((entry, i) => {
    const page = cursor
    cursor += bodyLengths[i]!
    return { title: entry.title, key: entry.key, version: entry.version, page }
  })
  const toc = settings.tableOfContents
    ? await renderHtmlDocumentPdf({
        ...paper,
        marginMm: 20,
        bodyHtml: tableOfContentsHtml(tocRows, accent),
      })
    : null

  const parts: ComposePart[] = []
  if (settings.coverPage) {
    parts.push({
      bytes: await renderHtmlDocumentPdf({
        ...paper,
        marginMm: 0,
        bodyHtml: coverHtml(input, accent),
      }),
      unnumbered: true,
    })
  }
  if (toc) parts.push({ bytes: toc, unnumbered: true })

  input.entries.forEach((entry, i) => {
    // Each document's block is page i of the single rendered sheets document —
    // either as a sheet in its own right, or as a band on the document's first
    // page.
    if (controlSheetsPdf && ownPage) {
      parts.push({ bytes: controlSheetsPdf, pages: [i] })
      parts.push({ bytes: entry.pdf })
      return
    }
    parts.push({
      bytes: entry.pdf,
      ...(controlSheetsPdf
        ? { letterhead: { bytes: controlSheetsPdf, page: i, heightPt: CONTROL_BAND_PT } }
        : {}),
    })
  })

  const stamp = formatStamp(now, input.timeZone)
  return composePdf({
    geometry,
    parts,
    marginPt: Math.max(0, settings.contentMarginMm) * PT_PER_MM,
    title: input.title,
    author: input.tenantName,
    footer: settings.footer
      ? {
          cells: (page, total) => ({
            left: 'UNCONTROLLED WHEN PRINTED',
            center: `PAGE ${page} OF ${total}`,
            right: `PRINTED ${stamp}`,
          }),
          subline: () => input.tenantName.toUpperCase(),
        }
      : undefined,
  })
}
