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

/** A comfortable, printable margin for a manual page, in twips (1 inch). */
const STANDARD_MARGIN_TWIPS = 1440
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
  const next = scaleRunSizes(
    setMarginsInDocumentXml(
      clampMarginsInDocumentXml(setPageSizeInDocumentXml(documentXml, size), size),
    ),
    factor,
  )

  // styles.xml carries the defaults a run inherits when it declares no size of
  // its own, so it has to move by the same factor or those runs drift apart
  // from the ones that do.
  const styles = stylesForSize
  const nextStyles = styles === null ? null : scaleRunSizes(styles, factor)

  if (next === documentXml && (nextStyles === null || nextStyles === styles)) return docx
  zip.file('word/document.xml', next)
  if (nextStyles !== null) zip.file('word/styles.xml', nextStyles)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}
