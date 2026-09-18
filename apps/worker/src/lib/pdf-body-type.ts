import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

// How big a rendered document's body text actually looks, and what paper it is
// on. Used when normalising a master: declared point size settles nothing when
// one document is set in Liberation Serif and the next in a sans face, so the
// conversion scales by what the render measures rather than what the XML says.
//
// Uses poppler's `pdftotext -bbox-layout`, which reports per-word boxes without
// rasterising — a few hundred pages measure in well under a second.

/** Rounding for the type histogram, in points. */
const BUCKET_PT = 0.5

export type RenderedTypeMetrics = {
  /** Sheet width in points, from the first page. */
  pageWidthPt: number | null
  /** Modal word height in points — what a reader perceives as "the text". */
  bodyTypePt: number | null
  /**
   * Top of the highest word on page one, in points from the sheet edge.
   *
   * Says whether a render already leaves the controlled-header strip clear.
   * `null` when page one carries no text at all.
   */
  firstPageTopPt: number | null
  /**
   * Where the body's text block starts, in points from the left edge.
   *
   * The MODAL line start, not the leftmost: a centred title or a table that
   * overhangs the measure says nothing about where the body sits. Says whether
   * a master indents its whole body away from its own page margin.
   */
  bodyLeftPt: number | null
}

export async function measureRenderedType(pdf: Buffer): Promise<RenderedTypeMetrics> {
  const dir = await mkdtemp(join(tmpdir(), 'bhs-type-'))
  try {
    const input = join(dir, 'in.pdf')
    const output = join(dir, 'out.xhtml')
    await writeFile(input, pdf)
    await exec('pdftotext', ['-bbox-layout', input, output], { timeout: 120_000 })
    return parseRenderedType(await readFile(output, 'utf8'))
  } catch {
    // Measurement guides a conversion; it is never a reason to fail one.
    return {
      pageWidthPt: null,
      bodyTypePt: null,
      firstPageTopPt: null,
      bodyLeftPt: null,
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Pull the sheet width and the modal word height out of poppler's XHTML.
 *
 * The MODE, not a mean: a page mixes headings, captions and body, and a
 * document that opens with a title page would drag an average around.
 */
export function parseRenderedType(xhtml: string): RenderedTypeMetrics {
  const firstPage = /<page width="([\d.]+)" height="([\d.]+)">/.exec(xhtml)
  const pageWidthPt = firstPage ? Number(firstPage[1]) : null
  const firstPageXhtml = xhtml.split('<page ')[1] ?? ''

  const wordPattern = /<word xMin="[\d.]+" yMin="([\d.]+)" xMax="[\d.]+" yMax="([\d.]+)"/g
  const buckets = new Map<number, number>()
  for (let word = wordPattern.exec(xhtml); word; word = wordPattern.exec(xhtml)) {
    const height = Number(word[2]) - Number(word[1])
    if (!Number.isFinite(height) || height <= 0) continue
    const bucket = Math.round(height / BUCKET_PT) * BUCKET_PT
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1)
  }

  let bodyTypePt: number | null = null
  let best = 0
  for (const [bucket, count] of buckets) {
    // Ties go to the smaller size: body text outnumbers headings, so a tie is
    // more likely a sparse document than a genuinely large body.
    if (count > best || (count === best && bodyTypePt !== null && bucket < bodyTypePt)) {
      bodyTypePt = bucket
      best = count
    }
  }
  const tops = [...firstPageXhtml.matchAll(/<word xMin="[\d.]+" yMin="([\d.]+)"/g)].map((word) =>
    Number(word[1]),
  )

  return {
    pageWidthPt,
    bodyTypePt,
    firstPageTopPt: tops.length > 0 ? Math.min(...tops) : null,
    bodyLeftPt: measureBodyLeft(xhtml),
  }
}

/** Rounding for the line-start histogram, in points. */
const EDGE_PT = 2
/**
 * Rounding for grouping words into lines, in points.
 *
 * Not zero: a bullet is set in a different face from the text it introduces and
 * lands a fraction of a point off it, so rounding to the whole point split
 * every list item into a bullet "line" and a text "line".
 */
const LINE_PT = 2

/**
 * The modal left edge of the rendered lines.
 *
 * Words are grouped into lines first, because the start of a LINE is what a
 * reader sees as the margin; the start of a word is wherever a space fell.
 */
function measureBodyLeft(xhtml: string): number | null {
  const lefts = new Map<number, number>()
  for (const page of xhtml.split('<page ').slice(1)) {
    const lines = new Map<number, number>()
    for (const word of page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)"/g)) {
      const line = Math.round(Number(word[2]) / LINE_PT)
      const left = Number(word[1])
      lines.set(line, Math.min(lines.get(line) ?? Infinity, left))
    }
    for (const left of lines.values()) {
      const bucket = Math.round(left / EDGE_PT) * EDGE_PT
      lefts.set(bucket, (lefts.get(bucket) ?? 0) + 1)
    }
  }
  return mode(lefts)
}

/** Ties go to the value nearer the sheet edge, which is the likelier margin. */
function mode(counts: Map<number, number>): number | null {
  let best: number | null = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && best !== null && value < best)) {
      best = value
      bestCount = count
    }
  }
  return best
}
