import { describe, expect, it } from 'vitest'
import { bookTypeScales, type BookDocumentMetrics } from './book-type-scale'

const BOX = { widthPt: 555, heightPt: 690 }

function doc(bodyTypePt: number | null, width = 500, height = 700): BookDocumentMetrics {
  return { bodyTypePt, contentWidthPt: width, contentHeightPt: height }
}

describe('bookTypeScales', () => {
  it('renders every document at the same type size', () => {
    // The actual complaint: 39 documents set at 14.5pt beside 14 at 17.5pt, and
    // fitting each to the page preserved the difference exactly.
    const documents = [doc(14.5), doc(17.5), doc(13)]
    const scales = bookTypeScales(documents, BOX)
    const rendered = documents.map((d, i) => d.bodyTypePt! * scales[i]!)
    expect(rendered[0]).toBeCloseTo(rendered[1]!, 6)
    expect(rendered[1]).toBeCloseTo(rendered[2]!, 6)
  })

  it('never asks for a scale that would overflow a page', () => {
    // A document whose block already fills the sheet cannot be enlarged, so it
    // is the one that sets the book's type size.
    const tall = doc(12, 560, 820)
    const scales = bookTypeScales([doc(20), tall], BOX)
    for (const [index, document] of [doc(20), tall].entries()) {
      const scale = scales[index]!
      expect(document.contentWidthPt * scale).toBeLessThanOrEqual(BOX.widthPt + 1e-6)
      expect(document.contentHeightPt * scale).toBeLessThanOrEqual(BOX.heightPt + 1e-6)
    }
  })

  it('leaves an unmeasurable document to fit on its own', () => {
    // An image-only scan has no type to match; cropping and scaling it to a
    // text size would be guesswork.
    const scales = bookTypeScales([doc(14.5), doc(null)], BOX)
    expect(scales[0]).not.toBeNull()
    expect(scales[1]).toBeNull()
  })

  it('returns no scales when nothing could be measured', () => {
    expect(bookTypeScales([doc(null), doc(null)], BOX)).toEqual([null, null])
  })

  it('ignores a nonsense measurement rather than dividing by it', () => {
    const scales = bookTypeScales(
      [doc(14.5), doc(0), { bodyTypePt: 12, contentWidthPt: 0, contentHeightPt: 0 }],
      BOX,
    )
    expect(scales[0]).not.toBeNull()
    expect(scales[1]).toBeNull()
    expect(scales[2]).toBeNull()
  })

  it('keeps a single document at its own fit', () => {
    const only = doc(14.5, 500, 700)
    const [scale] = bookTypeScales([only], BOX)
    expect(scale).toBeCloseTo(Math.min(555 / 500, 690 / 700), 6)
  })
})
