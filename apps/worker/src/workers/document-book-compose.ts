import { composePdf, pageGeometry, type ComposePart } from '@beaconhs/office'
import type { DocumentBookPrintSettings } from '@beaconhs/db/schema'
import { resolveBookPrintSettings } from '@beaconhs/db'
import { renderHtmlDocumentPdf } from '@beaconhs/forms-pdf'
import { CONTROLLED_HEADER_BAND_PT } from '@beaconhs/office/docx-page-size'

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
  kind: 'document'
  title: string
  /** Per-page text extents, null where a page has nothing measurable. */
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

/** A divider that names the run of documents after it. */
/**
 * A chapter opens a major part of the manual; a section groups documents inside
 * it. Both print as a divider page and both structure the contents listing —
 * they differ only in weight.
 */
type BookHeading = { kind: 'chapter' | 'section'; title: string }

export type ComposeBookNode = BookEntry | BookHeading

/**
 * A cover designed in the PDF template designer, already merged with the
 * book's values. When a tenant has one, it replaces the generated cover
 * wholesale — the point of the designer is that the tenant owns the layout.
 */
type DesignedCover = {
  html: string
  marginMm: number
}

export type ComposeBookInput = {
  title: string
  description?: string | null
  tenantName: string
  logoUrl?: string | null
  accentColor?: string | null
  publishedAt?: Date | null
  settings?: DocumentBookPrintSettings | null
  entries: ComposeBookNode[]
  /** IANA zone for the printed-at stamp and document dates. */
  timeZone: string
  now?: Date
  designedCover?: DesignedCover | null
}

const PT_PER_MM = 72 / 25.4

/** Footer geometry — `stampFooter`'s own defaults, which the book keeps. */
const FOOTER_MARGIN_PT = 28
const FOOTER_FONT_PT = 7.5
/**
 * Strip kept clear at the foot of every numbered page.
 *
 * The footer is stamped AFTER imposition, so without reserving its band the
 * imposed document simply runs underneath the page number. Covers the main row
 * (baseline at the footer margin) plus the company subline below it, with a
 * few points of air.
 */
const FOOTER_RESERVE_PT = FOOTER_MARGIN_PT + FOOTER_FONT_PT + 10

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

type TocRow =
  | { kind: 'chapter'; title: string; number: number; page: number }
  | { kind: 'section'; title: string; page: number }
  | { kind: 'document'; title: string; key: string; version: number; page: number }

/**
 * A divider page: the heading, centred, with the accent rule.
 *
 * A 196-document manual with nothing between its documents is unreadable —
 * this is the page a reader flips to when looking for a part of the book. A
 * chapter divider carries more weight than a section's so the two are
 * distinguishable while thumbing through the printed copy.
 */
function dividerHtml(heading: BookHeading, accent: string, chapterNumber: number | null): string {
  const isChapter = heading.kind === 'chapter'
  const eyebrow =
    isChapter && chapterNumber !== null
      ? `<div style="font-size:11px;font-weight:700;letter-spacing:.32em;text-transform:uppercase;color:#64748b;margin-bottom:18px">Chapter ${chapterNumber}</div>`
      : ''
  return `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 14%">
      ${eyebrow}
      <div style="width:${isChapter ? 96 : 64}px;height:${isChapter ? 4 : 3}px;background:${accent};margin-bottom:26px"></div>
      <h2 style="margin:0;font-size:${isChapter ? 44 : 30}px;line-height:1.15;font-weight:700;color:#0f172a">${escapeHtml(heading.title)}</h2>
      ${isChapter ? `<div style="width:96px;height:4px;background:${accent};margin-top:26px"></div>` : ''}
    </div>`
}

function tableOfContentsHtml(rows: TocRow[], accent: string): string {
  // Sections become headings within the listing, so the contents mirrors the
  // shape of the book rather than presenting 196 undifferentiated lines.
  const items = rows
    .map((row) =>
      row.kind === 'chapter'
        ? `
      <tr>
        <td colspan="3" style="padding:22px 0 6px">
          <div style="font-size:9px;font-weight:700;letter-spacing:.3em;text-transform:uppercase;color:#94a3b8">Chapter ${row.number}</div>
          <div style="font-size:14px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#0f172a;margin-top:3px">${escapeHtml(row.title)}</div>
          <div style="height:3px;background:${accent};width:100%;margin-top:6px"></div>
        </td>
      </tr>`
        : row.kind === 'section'
          ? `
      <tr>
        <td colspan="3" style="padding:14px 0 5px 10px">
          <div style="font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#334155">${escapeHtml(row.title)}</div>
          <div style="height:2px;background:${accent};width:46px;margin-top:5px"></div>
        </td>
      </tr>`
          : `
      <tr>
        <td style="padding:7px 0 7px 22px;font-size:12px;color:#0f172a;">
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

  // Split once: control sheets and page maths only concern documents, while
  // dividers need their own generated page.
  const documents = input.entries.flatMap((node) => (node.kind === 'document' ? [node] : []))
  const headings = input.entries.flatMap((node) => (node.kind === 'document' ? [] : [node]))

  // Control sheets are part of the body, so they must exist before the contents
  // can know where anything starts.
  //
  // Rendered as ONE multi-page document rather than one render per document.
  // Each sheet is a few hundred bytes of markup, but a browser render costs
  // ~60ms of startup regardless — on a 196-document manual that was ~11s of a
  // ~12s render, dwarfing every other phase combined. One render, then each
  // sheet is sliced out by page index at composition time.
  const controlSheetsPdf =
    settings.documentHeaders && documents.length > 0
      ? await renderHtmlDocumentPdf({
          ...paper,
          marginMm: settings.documentHeadersOnOwnPage ? 18 : 4,
          // When the block rides on a document it is a BAND, so it must be
          // rendered at band size. On a full sheet, fitting it into the band
          // scales the whole page and the table shrinks to a sixth of its size.
          ...(settings.documentHeadersOnOwnPage
            ? {}
            : { pageSizePt: { width: geometry.width, height: CONTROLLED_HEADER_BAND_PT } }),
          bodyHtml: documents
            .map(
              (entry, i) =>
                `<div style="${i > 0 ? 'page-break-before:always;' : ''}">${controlSheetHtml(entry, accent, input.timeZone, settings.documentHeadersOnOwnPage)}</div>`,
            )
            .join(''),
        })
      : null

  // Divider pages, likewise batched into one render. Chapters are numbered in
  // book order, so the count has to run across the whole heading list rather
  // than per render.
  let dividerChapterNumber = 0
  const dividerPagesPdf =
    headings.length > 0
      ? await renderHtmlDocumentPdf({
          ...paper,
          marginMm: 0,
          bodyHtml: headings
            .map((heading, i) => {
              const number = heading.kind === 'chapter' ? ++dividerChapterNumber : null
              return `<div style="${i > 0 ? 'page-break-before:always;' : ''}">${dividerHtml(heading, accent, number)}</div>`
            })
            .join(''),
        })
      : null

  // A block that rides on the document adds no page of its own, so it does not
  // move where anything starts.
  const ownPage = Boolean(controlSheetsPdf) && settings.documentHeadersOnOwnPage

  // Walk the book in order, assigning each node its first printed page.
  //
  // Printed numbers start at the first BODY page: the cover and the contents
  // are unnumbered, exactly as a reader would count. That also means the
  // numbers do not depend on how long the contents itself runs to, so there is
  // no chicken-and-egg to resolve — offsetting by the front matter simply made
  // every entry wrong by the length of the contents.
  let cursor = 1
  let chapterNumber = 0
  const tocRows: TocRow[] = input.entries.map((node) => {
    const page = cursor
    // Both heading kinds occupy one divider page. Tested together because
    // `kind` is a union on BookHeading, which a single-value check cannot
    // narrow away from the document arm.
    if (node.kind !== 'document') {
      cursor += 1
      if (node.kind === 'chapter') {
        chapterNumber += 1
        return { kind: 'chapter', title: node.title, number: chapterNumber, page }
      }
      return { kind: 'section', title: node.title, page }
    }
    cursor += (ownPage ? 1 : 0) + Math.max(1, node.pageCount)
    return {
      kind: 'document',
      title: node.title,
      key: node.key,
      version: node.version,
      page,
    }
  })

  const toc = settings.tableOfContents
    ? await renderHtmlDocumentPdf({
        ...paper,
        marginMm: 20,
        bodyHtml: tableOfContentsHtml(tocRows, accent),
      })
    : null

  // Pages are imposed WHOLE.
  //
  // They used to be cropped to their measured text and scaled to fill the
  // sheet, which evened out documents authored at different sizes — but the
  // measurement is of TEXT, and a page's rules, borders, images and form boxes
  // are not text. A Communication Log came through the book as a blank sheet
  // with its heading on it: the table around the empty cells fell outside the
  // text box and was cropped away.
  //
  // Evening out now happens where it belongs, on the master: every document is
  // normalised to the same paper, margins and body size before it is ever
  // rendered (see @beaconhs/office/docx-page-size), so imposing whole pages
  // gives a uniform book and cannot lose content.
  const marginPt = Math.max(0, settings.contentMarginMm) * PT_PER_MM
  const footerReservePt = settings.footer ? FOOTER_RESERVE_PT : 0

  const parts: ComposePart[] = []
  if (settings.coverPage) {
    // A designed cover wins outright: the tenant owns that layout, and second
    // guessing it with generated markup would defeat the designer.
    const cover = input.designedCover
    parts.push({
      bytes: await renderHtmlDocumentPdf({
        ...paper,
        marginMm: cover ? cover.marginMm : 0,
        bodyHtml: cover ? cover.html : coverHtml(input, accent),
      }),
      unnumbered: true,
    })
  }
  if (toc) parts.push({ bytes: toc, unnumbered: true })

  let documentIndex = 0
  let headingIndex = 0
  for (const node of input.entries) {
    if (node.kind !== 'document') {
      // Numbered, not `unnumbered`: a divider is a page of the manual a reader
      // pages past, and skipping it would make every following number wrong.
      if (dividerPagesPdf) parts.push({ bytes: dividerPagesPdf, pages: [headingIndex] })
      headingIndex += 1
      continue
    }
    const i = documentIndex++
    // Each document's block is page i of the single rendered sheets document —
    // either as a sheet in its own right, or as a band on the document's first
    // page.
    if (controlSheetsPdf && ownPage) {
      parts.push({ bytes: controlSheetsPdf, pages: [i] })
      parts.push({ bytes: node.pdf })
      continue
    }
    parts.push({
      bytes: node.pdf,
      ...(controlSheetsPdf
        ? {
            letterhead: {
              bytes: controlSheetsPdf,
              page: i,
              heightPt: CONTROLLED_HEADER_BAND_PT,
              // The document's own render already left this strip clear, so
              // the band lands in blank space. Reserving it a second time
              // would shrink only the pages that carry a block — measured on
              // a 244-page manual, those came out at 9.5pt against 11.5pt
              // everywhere else, with double the left margin.
              reserveSpace: false,
            },
          }
        : {}),
    })
  }

  const stamp = formatStamp(now, input.timeZone)
  return composePdf({
    geometry,
    parts,
    marginPt,
    footerReservePt,
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
