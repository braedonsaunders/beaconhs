import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export type ContentBox = { left: number; bottom: number; right: number; top: number }

/** Padding around measured text, so descenders and rules are not shaved. */
const PAD_PT = 6
/**
 * A measured box must be a believable text block. Anything smaller is usually a
 * stray page number or a scan with one OCR'd word, and fitting THAT to the page
 * would blow it up to fill the sheet.
 */
const MIN_FRACTION = 0.15

/**
 * Measure the text extents of every page in a PDF.
 *
 * Returns one entry per page, null where there is nothing believable to
 * measure — an image-only scan has no extractable text, and such a page must
 * render whole rather than be cropped to nothing.
 *
 * Uses poppler's `pdftotext -bbox-layout`, which reports per-word boxes without
 * rasterising: 261 pages measure in well under a second, so this can run on
 * every render instead of needing a cache.
 */
export async function measureTextContentBoxes(pdf: Buffer): Promise<(ContentBox | null)[]> {
  const pages = await measurePages(pdf)
  return unifyContentBoxes(pages.map((page) => (page.box ? floorContentBox(page.box, page) : null)))
}

async function measurePages(pdf: Buffer): Promise<MeasuredPage[]> {
  const dir = await mkdtemp(join(tmpdir(), 'bhs-bbox-'))
  try {
    const input = join(dir, 'in.pdf')
    const output = join(dir, 'out.xhtml')
    await writeFile(input, pdf)
    await exec('pdftotext', ['-bbox-layout', input, output], { timeout: 120_000 })
    return parseBboxPages(await readFile(output, 'utf8'))
  } catch {
    // Measurement is an enhancement, never a reason to fail a book. Without it
    // pages simply fit whole, exactly as they did before.
    return []
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

type MeasuredPage = { width: number; height: number; box: ContentBox | null }

/** Just the boxes, for callers that do not need the sheet they were measured on. */
export function parseBboxXhtml(xhtml: string): (ContentBox | null)[] {
  return parseBboxPages(xhtml).map((page) => page.box)
}

/**
 * Pull page dimensions and word boxes out of poppler's XHTML.
 *
 * Its coordinates are points with the origin at the TOP left, while PDF user
 * space has it at the bottom left — the flip is the whole reason this is a
 * function rather than an inline regex.
 */
function parseBboxPages(xhtml: string): MeasuredPage[] {
  const pages: MeasuredPage[] = []
  const pagePattern = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g
  const wordPattern = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g

  for (let page = pagePattern.exec(xhtml); page; page = pagePattern.exec(xhtml)) {
    const width = Number(page[1])
    const height = Number(page[2])
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    wordPattern.lastIndex = 0
    for (let word = wordPattern.exec(page[3]!); word; word = wordPattern.exec(page[3]!)) {
      minX = Math.min(minX, Number(word[1]))
      minY = Math.min(minY, Number(word[2]))
      maxX = Math.max(maxX, Number(word[3]))
      maxY = Math.max(maxY, Number(word[4]))
    }

    if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
      pages.push({ width, height, box: null })
      continue
    }

    const left = Math.max(0, minX - PAD_PT)
    const right = Math.min(width, maxX + PAD_PT)
    // Flip: poppler's yMax is nearest the bottom of the sheet.
    const bottom = Math.max(0, height - maxY - PAD_PT)
    const top = Math.min(height, height - minY + PAD_PT)

    const wideEnough = (right - left) / width >= MIN_FRACTION
    const tallEnough = (top - bottom) / height >= MIN_FRACTION
    pages.push({
      width,
      height,
      box: wideEnough && tallEnough ? { left, bottom, right, top } : null,
    })
  }

  return pages
}

/**
 * The most a page may be enlarged, expressed as the smallest fraction of the
 * sheet a crop box is allowed to be.
 *
 * Fitting a measured box to the sheet is what equalises type size between
 * documents — but a page holding one short paragraph would be blown up until
 * that paragraph filled the sheet. Floor the box and the magnification is
 * bounded with it, at roughly 1.7x.
 */
const MIN_BOX_FRACTION = 0.58

/**
 * Collapse a document's per-page boxes into ONE box used for every page.
 *
 * Per-page cropping normalises between documents but breaks WITHIN one: a page
 * that happens to end after three lines gets magnified relative to the page
 * before it, so type size changes mid-document. A document is typeset once, so
 * it must be scaled once — the union of its text extents is that one box, and
 * a short page simply keeps the whitespace below its text.
 *
 * Pages that measured nothing stay null: an image-only scan has no text to
 * bound, and cropping it to the text column would cut the image.
 */
export function unifyContentBoxes(boxes: (ContentBox | null)[]): (ContentBox | null)[] {
  const measured = boxes.filter((box): box is ContentBox => box !== null)
  if (measured.length === 0) return boxes

  const union = measured.reduce<ContentBox>(
    (acc, box) => ({
      left: Math.min(acc.left, box.left),
      bottom: Math.min(acc.bottom, box.bottom),
      right: Math.max(acc.right, box.right),
      top: Math.max(acc.top, box.top),
    }),
    measured[0]!,
  )

  return boxes.map((box) => (box === null ? null : union))
}

/**
 * Grow a box that is too small a share of its page, so fitting it to the sheet
 * cannot magnify the content past what is readable as a book.
 *
 * Grows about the box's own centre and then slides back inside the page, so a
 * column sitting against one margin does not get pushed off the sheet.
 */
export function floorContentBox(
  box: ContentBox,
  page: { width: number; height: number },
): ContentBox {
  const grow = (low: number, high: number, limit: number): { low: number; high: number } => {
    const size = high - low
    const wanted = limit * MIN_BOX_FRACTION
    if (size >= wanted || wanted > limit) return { low, high }
    const pad = (wanted - size) / 2
    let nextLow = low - pad
    let nextHigh = high + pad
    if (nextLow < 0) {
      nextHigh -= nextLow
      nextLow = 0
    }
    if (nextHigh > limit) {
      nextLow -= nextHigh - limit
      nextHigh = limit
    }
    return { low: Math.max(0, nextLow), high: Math.min(limit, nextHigh) }
  }

  const horizontal = grow(box.left, box.right, page.width)
  const vertical = grow(box.bottom, box.top, page.height)
  return {
    left: horizontal.low,
    right: horizontal.high,
    bottom: vertical.low,
    top: vertical.high,
  }
}
