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
    return { pageWidthPt: null, bodyTypePt: null, firstPageTopPt: null }
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
  }
}
