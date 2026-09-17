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
  const dir = await mkdtemp(join(tmpdir(), 'bhs-bbox-'))
  try {
    const input = join(dir, 'in.pdf')
    const output = join(dir, 'out.xhtml')
    await writeFile(input, pdf)
    await exec('pdftotext', ['-bbox-layout', input, output], { timeout: 120_000 })
    return parseBboxXhtml(await readFile(output, 'utf8'))
  } catch {
    // Measurement is an enhancement, never a reason to fail a book. Without it
    // pages simply fit whole, exactly as they did before.
    return []
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Pull page dimensions and word boxes out of poppler's XHTML.
 *
 * Its coordinates are points with the origin at the TOP left, while PDF user
 * space has it at the bottom left — the flip is the whole reason this is a
 * function rather than an inline regex.
 */
export function parseBboxXhtml(xhtml: string): (ContentBox | null)[] {
  const boxes: (ContentBox | null)[] = []
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
      boxes.push(null)
      continue
    }

    const left = Math.max(0, minX - PAD_PT)
    const right = Math.min(width, maxX + PAD_PT)
    // Flip: poppler's yMax is nearest the bottom of the sheet.
    const bottom = Math.max(0, height - maxY - PAD_PT)
    const top = Math.min(height, height - minY + PAD_PT)

    const wideEnough = (right - left) / width >= MIN_FRACTION
    const tallEnough = (top - bottom) / height >= MIN_FRACTION
    boxes.push(wideEnough && tallEnough ? { left, bottom, right, top } : null)
  }

  return boxes
}
