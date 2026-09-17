import { describe, expect, it } from 'vitest'
import { parseRenderedType } from './pdf-body-type'

function page(width: number, height: number, words: [number, number][]): string {
  const body = words
    .map(([top, bottom]) => `<word xMin="10" yMin="${top}" xMax="50" yMax="${bottom}">w</word>`)
    .join('')
  return `<page width="${width}" height="${height}">${body}</page>`
}

describe('parseRenderedType', () => {
  it('reports the sheet width so the caller can tell Letter from A4', () => {
    expect(parseRenderedType(page(612, 792, [[10, 22]])).pageWidthPt).toBe(612)
    expect(parseRenderedType(page(595.28, 841.89, [[10, 22]])).pageWidthPt).toBeCloseTo(595.28, 2)
  })

  it('reports the size most words are set in, not an average', () => {
    // A title page would drag a mean around; the body is what a reader sees.
    const words: [number, number][] = [
      ...Array.from({ length: 20 }, () => [0, 11] as [number, number]),
      ...Array.from({ length: 3 }, () => [0, 30] as [number, number]),
    ]
    expect(parseRenderedType(page(612, 792, words)).bodyTypePt).toBe(11)
  })

  it('buckets to the nearest half point', () => {
    // Renderers report fractional heights; without bucketing every word would
    // be its own size and the mode would be meaningless.
    expect(
      parseRenderedType(
        page(612, 792, [
          [0, 12.3],
          [0, 12.6],
        ]),
      ).bodyTypePt,
    ).toBe(12.5)
  })

  it('breaks a tie toward the smaller size', () => {
    // Body text outnumbers headings, so a tie is a sparse document rather than
    // a genuinely large body.
    expect(
      parseRenderedType(
        page(612, 792, [
          [0, 11],
          [0, 20],
        ]),
      ).bodyTypePt,
    ).toBe(11)
  })

  it('reports nothing for a page with no text', () => {
    expect(parseRenderedType(page(612, 792, [])).bodyTypePt).toBeNull()
  })

  it('survives output that is not poppler XHTML at all', () => {
    expect(parseRenderedType('<html/>')).toEqual({ pageWidthPt: null, bodyTypePt: null })
  })
})
