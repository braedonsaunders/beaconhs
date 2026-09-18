import JSZip from 'jszip'

// Every source document in a book should be the same paper. Imported masters
// are whatever their author used — the legacy import brought in 382 A4
// documents against one Letter — and a Letter book has to scale A4 down to fit,
// which shrinks the type and widens the margins on every page of the book.
//
// Rewriting the page size in the DOCX fixes it at the source: the author sees
// Letter in the editor and every later render is Letter, rather than each
// render fighting the same mismatch.

/** Twips per page size, portrait. Word measures in twentieths of a point. */
const PAGE_TWIPS = {
  letter: { width: 12240, height: 15840 },
  a4: { width: 11906, height: 16838 },
  legal: { width: 12240, height: 20160 },
} as const

export type DocxPageSize = keyof typeof PAGE_TWIPS

/** The page size a DOCX's first section declares, if it matches a known one. */
export function readDocxPageSize(documentXml: string): DocxPageSize | 'other' | null {
  const match = /<w:pgSz\b[^>]*\/>/.exec(documentXml)
  if (!match) return null
  const width = Number(/w:w="(\d+)"/.exec(match[0])?.[1] ?? NaN)
  const height = Number(/w:h="(\d+)"/.exec(match[0])?.[1] ?? NaN)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null
  const portrait = { width: Math.min(width, height), height: Math.max(width, height) }
  for (const [name, size] of Object.entries(PAGE_TWIPS)) {
    // Word and its converters disagree in the last twip or two.
    if (
      Math.abs(portrait.width - size.width) <= 4 &&
      Math.abs(portrait.height - size.height) <= 4
    ) {
      return name as DocxPageSize
    }
  }
  return 'other'
}

/**
 * Rewrite every section's page size, keeping each section's orientation.
 *
 * A document can change orientation mid-way — a portrait procedure with one
 * landscape table — so this works per `w:pgSz` rather than assuming the first
 * one speaks for the file.
 */
export function setPageSizeInDocumentXml(documentXml: string, size: DocxPageSize): string {
  const target = PAGE_TWIPS[size]
  return documentXml.replace(/<w:pgSz\b[^>]*\/>/g, (tag) => {
    const width = Number(/w:w="(\d+)"/.exec(tag)?.[1] ?? NaN)
    const height = Number(/w:h="(\d+)"/.exec(tag)?.[1] ?? NaN)
    const landscape = /w:orient="landscape"/.test(tag) || (width > height && Number.isFinite(width))
    const next = landscape
      ? { width: target.height, height: target.width }
      : { width: target.width, height: target.height }
    return tag
      .replace(/w:w="\d+"/, `w:w="${next.width}"`)
      .replace(/w:h="\d+"/, `w:h="${next.height}"`)
  })
}

/**
 * Pull horizontal margins in if the new page is narrower than the old one.
 *
 * Going A4 → Letter the page gets WIDER, so this never fires; it exists so the
 * reverse, or Legal → Letter, cannot leave a section with margins that consume
 * the whole measure and a text column of nothing.
 */
export function clampMarginsInDocumentXml(documentXml: string, size: DocxPageSize): string {
  const width = PAGE_TWIPS[size].width
  // A section must keep at least this much for text, in twips (about 2 inches).
  const minimumMeasure = 2880
  return documentXml.replace(/<w:pgMar\b[^>]*\/>/g, (tag) => {
    const left = Number(/w:left="(\d+)"/.exec(tag)?.[1] ?? NaN)
    const right = Number(/w:right="(\d+)"/.exec(tag)?.[1] ?? NaN)
    if (!Number.isFinite(left) || !Number.isFinite(right)) return tag
    if (width - left - right >= minimumMeasure) return tag
    const allowance = Math.max(0, Math.floor((width - minimumMeasure) / 2))
    return tag
      .replace(/w:left="\d+"/, `w:left="${Math.min(left, allowance)}"`)
      .replace(/w:right="\d+"/, `w:right="${Math.min(right, allowance)}"`)
  })
}

/**
 * Return the DOCX with its paper size changed, or the original bytes when it is
 * already that size.
 *
 * Only `word/document.xml` carries `w:sectPr`; headers and footers inherit the
 * section they belong to, so nothing else needs touching.
 */
export async function setDocxPageSize(docx: Buffer, size: DocxPageSize): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('Not a Word document: word/document.xml is missing')
  const documentXml = await entry.async('string')
  if (readDocxPageSize(documentXml) === size) return docx

  const rewritten = clampMarginsInDocumentXml(setPageSizeInDocumentXml(documentXml, size), size)
  zip.file('word/document.xml', rewritten)
  // DEFLATE keeps the part compressed the way Word writes it; STORE would work
  // but inflates every rewritten master in storage.
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

// ---------------------------------------------------------------------------
// Typography
//
// Page size alone does not make a book read as one document. The imported
// masters carry 1cm/2cm asymmetric margins and body text at 11.5pt, 12pt and
// 13.5pt depending on the document. Composing those preserves the difference:
// measured on the manual, body type came out 8.5–11pt across pages and the text
// column filled 58% of the sheet.
//
// Normalising the MASTER is what fixes it at the source, the same way page size
// was fixed. Everything downstream then needs no per-document compensation.
// ---------------------------------------------------------------------------

/**
 * The house page margin, in twips.
 *
 * 0.5 inch, not the conventional 1 inch: these documents indent their own
 * paragraphs and lists, so a 1-inch page margin on top of that left the text
 * column at 59% of the sheet. Half an inch still clears the non-printable
 * border of an office printer.
 */
const STANDARD_MARGIN_TWIPS = 720
/** Header/footer band inset, in twips. */
const STANDARD_HEADER_TWIPS = 720
/** Target body size, in half-points. 22 = 11pt. */
const STANDARD_BODY_HALF_POINTS = 22

/** Run properties only. `w:sz` inside a border means eighths of a point. */
const RUN_PROPERTIES = /<w:rPr>[\s\S]*?<\/w:rPr>/g
const RUN_SIZE = /<w:(sz|szCs) w:val="(\d+)"\s*\/>/g
/** A whole run, so runs that declare no size can be attributed to the default. */
const RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g
/** Word's fallback when neither the run nor the defaults say anything. */
const WORD_DEFAULT_HALF_POINTS = 20

/** The size a run inherits when it declares none, from `w:docDefaults`. */
export function defaultRunSize(stylesXml: string | null): number {
  if (!stylesXml) return WORD_DEFAULT_HALF_POINTS
  const defaults = /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/.exec(stylesXml)?.[0]
  const size = Number(/<w:sz w:val="(\d+)"/.exec(defaults ?? '')?.[1] ?? NaN)
  return Number.isFinite(size) && size > 0 ? size : WORD_DEFAULT_HALF_POINTS
}

/**
 * The size most of a document's runs are set in, in half-points.
 *
 * The mode, not the mean: a document is mostly body text, and a title set 8
 * points larger should not drag the figure the body is matched on.
 *
 * Runs that declare no size count toward `defaultHalfPoints`, because most of
 * them usually do — one real master had 84 runs and a single explicit size, so
 * counting only the explicit ones matched the body to a lone heading and
 * shrank the entire document.
 */
export function modalRunSize(documentXml: string, defaultHalfPoints: number): number | null {
  const counts = new Map<number, number>()
  for (const run of documentXml.match(RUN) ?? []) {
    const properties = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(run)?.[0] ?? ''
    const declared = Number(/<w:sz w:val="(\d+)"/.exec(properties)?.[1] ?? NaN)
    const size = Number.isFinite(declared) && declared > 0 ? declared : defaultHalfPoints
    counts.set(size, (counts.get(size) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [size, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && size < best)) {
      best = size
      bestCount = count
    }
  }
  return best
}

/**
 * Multiply every run size, keeping the document's own hierarchy.
 *
 * Scaling rather than setting one size everywhere is deliberate: a heading two
 * steps above the body should stay two steps above it.
 */
export function scaleRunSizes(xml: string, factor: number): string {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return xml
  return xml.replace(RUN_PROPERTIES, (block) =>
    block.replace(RUN_SIZE, (tag, name, value) => {
      const scaled = Math.max(2, Math.round(Number(value) * factor))
      return `<w:${name} w:val="${scaled}"/>`
    }),
  )
}

/** Give every section the same margins. */
export function setMarginsInDocumentXml(documentXml: string): string {
  return documentXml.replace(
    /<w:pgMar\b[^>]*\/>/g,
    `<w:pgMar w:top="${STANDARD_MARGIN_TWIPS}" w:right="${STANDARD_MARGIN_TWIPS}" ` +
      `w:bottom="${STANDARD_MARGIN_TWIPS}" w:left="${STANDARD_MARGIN_TWIPS}" ` +
      `w:header="${STANDARD_HEADER_TWIPS}" w:footer="${STANDARD_HEADER_TWIPS}" w:gutter="0"/>`,
  )
}

/**
 * Put a master on the house paper, margins and body size.
 *
 * Returns the original bytes when nothing needed changing, so re-running this
 * over a library does not churn storage.
 */
export async function normalizeDocxTypography(
  docx: Buffer,
  size: DocxPageSize,
  options: {
    /**
     * Scale run sizes by this instead of matching the declared point size.
     *
     * Point size alone does not settle how big text LOOKS: two masters both set
     * at 11pt render different glyph heights when one is Liberation Serif and
     * the other a sans face. A caller that has rendered the document and
     * measured it passes the ratio it actually needs.
     */
    sizeFactor?: number
    /**
     * Pull every paragraph indent in by this many twips.
     *
     * Same reasoning as `sizeFactor`: the XML cannot say how far in the text
     * actually lands — a paragraph indent, a list level and a table inset all
     * stack — so the caller renders the document, measures where the body
     * block starts, and passes the excess over the house margin.
     */
    indentReduceTwips?: number
  } = {},
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('Not a Word document: word/document.xml is missing')
  const documentXml = await entry.async('string')

  const stylesEntryForSize = zip.file('word/styles.xml')
  const stylesForSize = stylesEntryForSize ? await stylesEntryForSize.async('string') : null
  const mode = modalRunSize(documentXml, defaultRunSize(stylesForSize))
  const factor =
    options.sizeFactor !== undefined
      ? options.sizeFactor
      : mode
        ? STANDARD_BODY_HALF_POINTS / mode
        : 1
  // Order matters: paper and margins settle the measure, and the measure is
  // what a table is fitted to.
  const paper = clampMarginsInDocumentXml(setPageSizeInDocumentXml(documentXml, size), size)
  const laid = setMarginsInDocumentXml(paper)
  const sized = scaleRunSizes(laid, factor)
  const tabled = fitTablesToMeasure(addTableBordersInDocumentXml(sized), size)
  const next = reduceIndentsInXml(tabled, options.indentReduceTwips ?? 0)

  // styles.xml carries the defaults a run inherits when it declares no size of
  // its own, so it has to move by the same factor or those runs drift apart
  // from the ones that do.
  const styles = stylesForSize
  const nextStyles =
    styles === null
      ? null
      : reduceIndentsInXml(scaleRunSizes(styles, factor), options.indentReduceTwips ?? 0)

  if (next === documentXml && (nextStyles === null || nextStyles === styles)) return docx
  zip.file('word/document.xml', next)
  if (nextStyles !== null) zip.file('word/styles.xml', nextStyles)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/**
 * Whether a master already carries the house paper and margins.
 *
 * Deterministic on purpose. The obvious idempotency check — "does it already
 * render at the target body size?" — never settles: rendered glyph heights
 * quantise, so a 12.5pt target is reached as 12 or 13 and the next pass tries
 * again. One real campaign rewrote the same 83 masters 291 times, oscillating
 * 13 → 12 → 13 → 12. Structure converges in a single pass.
 */
export async function isNormalizedDocx(docx: Buffer, size: DocxPageSize): Promise<boolean> {
  const entry = (await JSZip.loadAsync(docx)).file('word/document.xml')
  if (!entry) return false
  const documentXml = await entry.async('string')
  if (readDocxPageSize(documentXml) !== size) return false

  if (addTableBordersInDocumentXml(documentXml) !== documentXml) return false
  if (fitTablesToMeasure(documentXml, size) !== documentXml) return false

  const margins = documentXml.match(/<w:pgMar\b[^>]*\/>/g) ?? []
  if (margins.length === 0) return false
  return margins.every((tag) =>
    (['top', 'right', 'bottom', 'left'] as const).every(
      (edge) => Number(new RegExp(`w:${edge}="(\\d+)"`).exec(tag)?.[1]) === STANDARD_MARGIN_TWIPS,
    ),
  )
}

// ---------------------------------------------------------------------------
// First-page band
//
// A book stamps a controlled-document block across the top of each document's
// first page. The composer can only do that by shrinking the page to make room
// — which leaves every document's first page smaller than its own later pages:
// measured on a 244-page manual, the pages carrying a block rendered at 9.5pt
// against 11.5pt elsewhere, with double the left margin.
//
// Giving the block its own sheet fixes the type and costs a page per document
// — on a 196-document manual, 60 extra sheets. Reserving the strip when the
// document is RENDERED costs nothing: the render leaves the band blank and the
// composer draws into space that is already empty, at full page size.
//
// It is done at render, not in the stored master, so the author is not editing
// around a block of white space that only means something inside a book.
// ---------------------------------------------------------------------------

/**
 * Height of the strip a rendered document keeps clear at the top of its first
 * page, in points, for the controlled-document block a book stamps there.
 *
 * Every consumer must agree on it: the render reserves exactly this, and the
 * composer draws exactly this.
 */
export const CONTROLLED_HEADER_BAND_PT = 132

/**
 * The reserve is a spacer paragraph at the top of the body, not a first-page
 * header.
 *
 * The header spelling reads better and does not work: LibreOffice sizes a
 * section's header area once for the whole section, so a 96pt first-page
 * spacer pushed page TWO's text down 125pt as well. Measured on two real
 * masters, pages 2+ started at 161pt instead of the 36pt margin.
 */
function spacerParagraph(spacerTwips: number): string {
  return (
    '<w:p><w:pPr>' +
    '<w:ind w:left="0" w:right="0" w:firstLine="0"/>' +
    `<w:spacing w:before="0" w:after="0" w:line="${spacerTwips}" w:lineRule="exact"/>` +
    '<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr>' +
    '</w:pPr></w:p>'
  )
}

/** The blank strip the spacer must add, in twips, for a band of `bandPt`. */
function spacerTwipsFor(documentXml: string, bandPt: number): number {
  const top = Number(/<w:pgMar\b[^>]*\bw:top="(-?\d+)"/.exec(documentXml)?.[1] ?? NaN)
  const margin = Number.isFinite(top) ? top : STANDARD_MARGIN_TWIPS
  return Math.max(0, Math.round(bandPt * 20) - margin)
}

/** Every spacer this module has ever written, so a re-run replaces its own. */
const SPACER =
  /<w:p><w:pPr><w:ind w:left="0" w:right="0" w:firstLine="0"\/><w:spacing w:before="0" w:after="0" w:line="\d+" w:lineRule="exact"\/><w:rPr><w:sz w:val="2"\/><w:szCs w:val="2"\/><\/w:rPr><\/w:pPr><\/w:p>/g

function withSpacer(documentXml: string, bandPt: number): string {
  const stripped = documentXml.replace(SPACER, '')
  const body = /<w:body(?:\s[^>]*)?>/.exec(stripped)?.[0]
  if (!body) throw new Error('Not a Word document: no w:body')
  const twips = spacerTwipsFor(stripped, bandPt)
  // A zero-height spacer is not nothing — an empty paragraph still claims a
  // line — so a page whose margin already clears the band gets no paragraph.
  if (twips === 0) return stripped
  return stripped.replace(body, `${body}${spacerParagraph(twips)}`)
}

/**
 * Leave the top `bandPt` points of the document's first page blank.
 *
 * Idempotent: re-running over a master that already reserves the same height
 * returns the original bytes.
 */
export async function reserveFirstPageBand(docx: Buffer, bandPt: number): Promise<Buffer> {
  const zip = await JSZip.loadAsync(docx)
  const entry = zip.file('word/document.xml')
  if (!entry) throw new Error('Not a Word document: word/document.xml is missing')
  const documentXml = await entry.async('string')
  const next = withSpacer(documentXml, bandPt)
  if (next === documentXml) return docx
  zip.file('word/document.xml', next)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** Whether a master already reserves a band of exactly this height. */
export async function hasFirstPageBand(docx: Buffer, bandPt: number): Promise<boolean> {
  const entry = (await JSZip.loadAsync(docx)).file('word/document.xml')
  if (!entry) return false
  const documentXml = await entry.async('string')
  return withSpacer(documentXml, bandPt) === documentXml
}

// ---------------------------------------------------------------------------
// Import repairs
//
// Two defects the legacy import left in every master it produced. Both are
// invisible in the XML until you render it, and both read as "the formatting is
// wrong" rather than as anything a reader could describe.
// ---------------------------------------------------------------------------

/** Indent attributes, in both the transitional and strict spellings. */
const INDENT_START = /\bw:(left|start)="(-?\d+)"/g
const INDENT_END = /\bw:(right|end)="(-?\d+)"/g

/**
 * Pull every paragraph indent in by `twips`, never past the margin.
 *
 * Some imported masters indent their whole body about 1.2 inches, so the text
 * column fills 66% of the sheet against 83% for the rest of the library — the
 * page margin is right and the paragraphs are wrong. Subtracting a constant
 * keeps the document's own hierarchy: a list nested two levels deep stays two
 * levels deep.
 *
 * `word/numbering.xml` is deliberately untouched. Its ladder defines the list
 * LEVELS, and clamping the shallow ones at zero would flatten nesting; the
 * indents that show up in these documents are all paragraph-level, which
 * override numbering anyway.
 */
export function reduceIndentsInXml(xml: string, twips: number): string {
  if (!Number.isFinite(twips) || twips <= 0) return xml
  const pull = (value: string) => String(Math.max(0, Number(value) - twips))
  return xml
    .replace(/<w:ind\b[^>]*\/>/g, (tag) =>
      tag
        .replace(INDENT_START, (_, name, value) => `w:${name}="${pull(value)}"`)
        .replace(INDENT_END, (_, name, value) => `w:${name}="${pull(value)}"`),
    )
    .replace(/<w:tblInd\b[^>]*\/>/g, (tag) =>
      tag.replace(/\bw:w="(-?\d+)"/, (_, value) => `w:w="${pull(value)}"`),
    )
}

/** A plain single-line grid: half a point, the weight Word's Table Grid uses. */
const GRID_EDGE = 'w:val="single" w:sz="4" w:space="0" w:color="000000"'
const GRID =
  '<w:tblBorders>' +
  `<w:top ${GRID_EDGE}/><w:left ${GRID_EDGE}/><w:bottom ${GRID_EDGE}/>` +
  `<w:right ${GRID_EDGE}/><w:insideH ${GRID_EDGE}/><w:insideV ${GRID_EDGE}/>` +
  '</w:tblBorders>'
/** Schema order puts tblBorders after tblInd and before these. */
const AFTER_BORDERS = /<w:(shd|tblLayout|tblCellMar|tblLook)\b/

function tableIsBare(tbl: string): boolean {
  if (/<w:tblStyle\b/.test(tbl) || /<w:tblBorders>/.test(tbl)) return false
  // `<w:tcBorders></w:tcBorders>` — the element with nothing in it — declares
  // no border at all. Every table in the imported library carries exactly that.
  return !/<w:tcBorders>\s*<w:/.test(tbl)
}

/**
 * Give a grid to any table that declares no borders anywhere.
 *
 * The import emitted an empty `<w:tcBorders></w:tcBorders>` on every cell of
 * every table and dropped the edges inside it, so sign-in logs, schedules and
 * threshold tables all print as floating columns with no rules. No authoring
 * tool writes that, which is what makes this safe to repair wholesale.
 *
 * A one-cell table is layout, not data, and is left alone.
 */
export function addTableBordersInDocumentXml(documentXml: string): string {
  return documentXml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    if (!tableIsBare(tbl)) return tbl
    const cells = (tbl.match(/<w:tc>/g) ?? []).length
    if (cells < 2) return tbl
    const stripped = tbl.replace(/<w:tcBorders>\s*<\/w:tcBorders>/g, '')
    const properties = /<w:tblPr>[\s\S]*?<\/w:tblPr>/.exec(stripped)?.[0]
    if (!properties) return stripped.replace('<w:tbl>', `<w:tbl><w:tblPr>${GRID}</w:tblPr>`)
    const anchor = AFTER_BORDERS.exec(properties)
    const next = anchor
      ? properties.replace(anchor[0], `${GRID}${anchor[0]}`)
      : properties.replace('</w:tblPr>', `${GRID}</w:tblPr>`)
    return stripped.replace(properties, next)
  })
}

/** How wide a table may be, in twips, on a page with the house margins. */
function measureTwips(size: DocxPageSize): number {
  return PAGE_TWIPS[size].width - STANDARD_MARGIN_TWIPS * 2
}

const GRID_COL = /<w:gridCol\b[^>]*\bw:w="(\d+)"[^>]*\/>/g
/** Only `dxa` — a width in percent or set to auto is already relative. */
const CELL_WIDTH = /<w:(tblW|tcW)\b[^>]*\bw:w="(\d+)"[^>]*\bw:type="dxa"[^>]*\/>/g

/**
 * Shrink any table that is wider than the page to fit it.
 *
 * The imported masters were authored on A4 with 1cm margins, so most of their
 * tables declare exactly 11339 twips — 20cm — against the 10800 a Letter page
 * with half-inch margins allows. Two run to 1.9x and 2.3x that. They all use a
 * FIXED layout, so the declared widths are honoured and the overhang simply
 * falls off the right edge of the sheet: measured on the real manual, the last
 * column of a threshold-limit table was cut mid-word.
 *
 * Scaling every width by one factor keeps the table's proportions, and the
 * rounding remainder goes to the widest column so the parts still sum to the
 * whole.
 */
export function fitTablesToMeasure(documentXml: string, size: DocxPageSize): string {
  const measure = measureTwips(size)
  return documentXml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const indent = Number(/<w:tblInd\b[^>]*\bw:w="(\d+)"/.exec(tbl)?.[1] ?? 0)
    const available = Math.max(1, measure - (Number.isFinite(indent) ? indent : 0))
    const columns = [...tbl.matchAll(/<w:gridCol\b[^>]*\bw:w="(\d+)"/g)].map((m) => Number(m[1]))
    const total = columns.reduce((sum, width) => sum + width, 0)
    if (total <= available || total === 0) return tbl

    const factor = available / total
    const scaled = columns.map((width) => Math.max(1, Math.round(width * factor)))
    // Hand the rounding error to the widest column, where it is least visible.
    const drift = available - scaled.reduce((sum, width) => sum + width, 0)
    const widest = scaled.indexOf(Math.max(...scaled))
    scaled[widest] = Math.max(1, (scaled[widest] ?? 1) + drift)

    let column = 0
    return tbl
      .replace(GRID_COL, (tag, width) =>
        tag.replace(`w:w="${width}"`, `w:w="${scaled[column++] ?? width}"`),
      )
      .replace(CELL_WIDTH, (tag, _name, width) =>
        tag.replace(`w:w="${width}"`, `w:w="${Math.max(1, Math.round(Number(width) * factor))}"`),
      )
  })
}
