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
