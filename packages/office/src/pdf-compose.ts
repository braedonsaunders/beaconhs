import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

// Composition primitives for stitching many source PDFs into one book.
//
// `pdfunite` concatenates bytes and nothing else: every source keeps its own
// page size, so a book assembled from LibreOffice output (A4) plus scanned
// uploads (Letter) plus an HTML cover (Letter) physically changes paper size as
// you page through it. These helpers impose every page onto one geometry and
// can stamp page furniture afterwards, which byte concatenation cannot do at
// all.

export type PageGeometry = { width: number; height: number }

/** Points, at 72dpi. */
export const PAGE_SIZES = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
  legal: { width: 612, height: 1008 },
  tabloid: { width: 792, height: 1224 },
} as const satisfies Record<string, PageGeometry>

export type PageSizeName = keyof typeof PAGE_SIZES

export function pageGeometry(size: PageSizeName, orientation: 'portrait' | 'landscape') {
  const base = PAGE_SIZES[size]
  return orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height }
}

function normalizeAngle(angle: number): number {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360
}

/**
 * Append every page of `source` to `out`, each centred on a page of exactly
 * `geometry` and scaled to fit without distortion.
 *
 * Honours `/Rotate`. A scanner that writes a landscape MediaBox with
 * `/Rotate 270` is displaying a portrait page, so the VISUAL box drives both
 * the fit and the placement — using the raw MediaBox would letterbox a
 * perfectly ordinary portrait scan into a sideways strip.
 *
 * Pages are never enlarged beyond 1:1 by default: blowing a small page up to
 * fill Letter magnifies scan artefacts and looks worse than honest margins.
 */
export async function imposePages(
  out: PDFDocument,
  sourceBytes: Uint8Array,
  geometry: PageGeometry,
  options: { allowUpscale?: boolean; pages?: readonly number[] } = {},
): Promise<number> {
  const src = await PDFDocument.load(sourceBytes, { ignoreEncryption: true })
  const available = src.getPageIndices()
  // A caller may want specific pages: rendering many small sheets as ONE
  // multi-page document and slicing it is dramatically cheaper than paying
  // browser startup per sheet.
  const indices = options.pages
    ? options.pages.filter((i) => Number.isInteger(i) && i >= 0 && i < available.length)
    : available
  if (indices.length === 0) return 0

  // A page with no content stream — a truly blank sheet, which scanners do
  // emit — cannot be embedded. It still occupies a page in the original, so
  // reproduce it as a blank page rather than failing the whole book.
  const drawable: number[] = []
  const blank = new Set<number>()
  for (const index of indices) {
    if (src.getPage(index).node.Contents()) drawable.push(index)
    else blank.add(index)
  }
  const embeddedByIndex = new Map<number, Awaited<ReturnType<typeof out.embedPdf>>[number]>()
  if (drawable.length > 0) {
    const embeds = await out.embedPdf(src, drawable)
    drawable.forEach((index, i) => embeddedByIndex.set(index, embeds[i]!))
  }

  indices.forEach((index) => {
    drawImposed(
      out,
      src,
      blank.has(index) ? undefined : embeddedByIndex.get(index),
      index,
      geometry,
      options,
    )
  })

  return indices.length
}

type EmbeddedPage = Awaited<ReturnType<PDFDocument['embedPdf']>>[number]

/**
 * Place one already-embedded page onto a fresh page of `geometry`.
 *
 * Shared by both entry points so the fit, the rotation handling and the
 * blank-page fallback cannot drift apart between them.
 */
function drawImposed(
  out: PDFDocument,
  src: PDFDocument,
  page: EmbeddedPage | undefined,
  index: number,
  geometry: PageGeometry,
  options: { allowUpscale?: boolean },
): void {
  if (!page) {
    out.addPage([geometry.width, geometry.height])
    return
  }
  const rotation = normalizeAngle(src.getPage(index).getRotation().angle)
  const quarterTurned = rotation === 90 || rotation === 270
  // Visual dimensions after the viewer applies /Rotate.
  const visualWidth = quarterTurned ? page.height : page.width
  const visualHeight = quarterTurned ? page.width : page.height

  const fit = Math.min(geometry.width / visualWidth, geometry.height / visualHeight)
  const scale = options.allowUpscale ? fit : Math.min(fit, 1)
  const drawnWidth = visualWidth * scale
  const drawnHeight = visualHeight * scale
  const left = (geometry.width - drawnWidth) / 2
  const bottom = (geometry.height - drawnHeight) / 2

  // drawPage rotates about the anchor point, which moves the box out of the
  // slot just measured. Shift the anchor to the corner the rotation sweeps the
  // content away from.
  const anchor =
    rotation === 90
      ? { x: left + drawnWidth, y: bottom }
      : rotation === 180
        ? { x: left + drawnWidth, y: bottom + drawnHeight }
        : rotation === 270
          ? { x: left, y: bottom + drawnHeight }
          : { x: left, y: bottom }

  out.addPage([geometry.width, geometry.height]).drawPage(page, {
    xScale: scale,
    yScale: scale,
    x: anchor.x,
    y: anchor.y,
    rotate: degrees(rotation),
  })
}

export type FooterCell = { left: string; center: string; right: string }

export type StampFooterOptions = {
  /** Called per page (1-based) with the total, returning the three columns. */
  cells: (pageNumber: number, pageCount: number) => FooterCell | null
  /** Optional second line, centred — typically the company name. */
  subline?: (pageNumber: number, pageCount: number) => string | null
  marginPt?: number
  fontSize?: number
}

/**
 * Draw a three-column footer onto every page.
 *
 * Returning `null` from `cells` skips a page, which is how the cover stays
 * clean while the body is numbered.
 */
export async function stampFooter(doc: PDFDocument, options: StampFooterOptions): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const size = options.fontSize ?? 7.5
  const margin = options.marginPt ?? 28
  const grey = rgb(0.42, 0.45, 0.5)
  const pages = doc.getPages()

  pages.forEach((page, index) => {
    const cells = options.cells(index + 1, pages.length)
    if (!cells) return
    drawRow(page, font, size, margin, grey, cells)
    const sub = options.subline?.(index + 1, pages.length)
    if (sub) {
      const width = font.widthOfTextAtSize(sub, size)
      page.drawText(sub, {
        x: (page.getWidth() - width) / 2,
        y: margin - size - 2,
        size,
        font,
        color: grey,
      })
    }
  })
}

function drawRow(
  page: PDFPage,
  font: PDFFont,
  size: number,
  margin: number,
  color: ReturnType<typeof rgb>,
  cells: FooterCell,
): void {
  const y = margin
  if (cells.left) page.drawText(cells.left, { x: margin, y, size, font, color })
  if (cells.center) {
    const width = font.widthOfTextAtSize(cells.center, size)
    page.drawText(cells.center, { x: (page.getWidth() - width) / 2, y, size, font, color })
  }
  if (cells.right) {
    const width = font.widthOfTextAtSize(cells.right, size)
    page.drawText(cells.right, { x: page.getWidth() - margin - width, y, size, font, color })
  }
}

/** Page count without imposing anything — used to number a table of contents. */
export async function countPages(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
  return doc.getPageCount()
}

export type ComposePart = {
  bytes: Uint8Array
  /** Excluded from footer stamping — used for covers and section dividers. */
  unnumbered?: boolean
  /** Zero-based subset of the source's pages, in the order given. */
  pages?: readonly number[]
}

export type ComposePdfInput = {
  geometry: PageGeometry
  parts: ComposePart[]
  footer?: Omit<StampFooterOptions, 'cells'> & {
    cells: (pageNumber: number, pageCount: number) => FooterCell | null
  }
  allowUpscale?: boolean
  title?: string
  author?: string
}

/**
 * Impose an ordered list of PDFs onto one geometry and return the result.
 *
 * This is the whole reason the book pipeline no longer shells out to
 * `pdfunite`: concatenation cannot normalise page size, cannot number pages
 * across documents, and cannot stamp a footer. Keeping pdf-lib behind this
 * function also keeps it a dependency of one package rather than three.
 *
 * Footer numbering counts only numbered pages, so a cover does not consume
 * "page 1" and the printed numbers match what a reader would count.
 */
export async function composePdf(input: ComposePdfInput): Promise<Buffer> {
  const out = await PDFDocument.create()
  const numbered: boolean[] = []

  // Parts frequently share a source: one multi-page document of generated
  // sheets contributes a single page to each member. Parsing and embedding that
  // source once per part is quadratic — on a 196-document book it turned a 12
  // second render into 35 and inflated the output by 5 MB through duplicated
  // resources. Each distinct source is loaded once and every page it
  // contributes is embedded in a single call.
  const sources = new Map<Uint8Array, { doc: PDFDocument; embedded: Map<number, EmbeddedPage> }>()
  for (const part of input.parts) {
    if (sources.has(part.bytes)) continue
    sources.set(part.bytes, {
      doc: await PDFDocument.load(part.bytes, { ignoreEncryption: true }),
      embedded: new Map(),
    })
  }
  for (const [bytes, source] of sources) {
    const available = source.doc.getPageIndices()
    const wanted = new Set<number>()
    for (const part of input.parts) {
      if (part.bytes !== bytes) continue
      const indices = part.pages
        ? part.pages.filter((i) => Number.isInteger(i) && i >= 0 && i < available.length)
        : available
      for (const index of indices) {
        if (source.doc.getPage(index).node.Contents()) wanted.add(index)
      }
    }
    const order = [...wanted]
    if (order.length === 0) continue
    const embeds = await out.embedPdf(source.doc, order)
    order.forEach((index, i) => source.embedded.set(index, embeds[i]!))
  }

  for (const part of input.parts) {
    const source = sources.get(part.bytes)!
    const available = source.doc.getPageIndices()
    const indices = part.pages
      ? part.pages.filter((i) => Number.isInteger(i) && i >= 0 && i < available.length)
      : available
    for (const index of indices) {
      drawImposed(out, source.doc, source.embedded.get(index), index, input.geometry, {
        allowUpscale: input.allowUpscale,
      })
      numbered.push(!part.unnumbered)
    }
  }

  if (input.footer) {
    const total = numbered.filter(Boolean).length
    let seen = 0
    const { cells, ...rest } = input.footer
    await stampFooter(out, {
      ...rest,
      cells: (page) => {
        if (!numbered[page - 1]) return null
        seen += 1
        return cells(seen, total)
      },
    })
  }

  if (input.title) out.setTitle(input.title)
  if (input.author) out.setAuthor(input.author)
  out.setProducer('BeaconHS')
  out.setCreationDate(new Date())

  return Buffer.from(await out.save())
}
