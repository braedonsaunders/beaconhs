import { describe, expect, it } from 'vitest'
import { parseRenderedType } from './pdf-body-type'

function page(width: number, height: number, words: [number, number][]): string {
  const body = words
    .map(([top, bottom]) => `<word xMin="10" yMin="${top}" xMax="50" yMax="${bottom}">w</word>`)
    .join('')
  return `<page width="${width}" height="${height}">${body}</page>`
}

function indented(width: number, height: number, lines: [number, number][]): string {
  const body = lines
    .map(
      ([left, size], i) =>
        `<word xMin="${left}" yMin="${100 + i * 14}" xMax="${left + 200}" yMax="${100 + i * 14 + size}">w</word>`,
    )
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
    expect(parseRenderedType('<html/>')).toEqual({
      pageWidthPt: null,
      bodyTypePt: null,
      firstPageTopPt: null,
      bodyLeftPt: null,
    })
  })

  it('reports where page one starts, ignoring later pages', () => {
    // How the caller tells a render that reserved the controlled-header strip
    // from one that did not. A later page starting higher says nothing.
    const xhtml = page(612, 792, [[132, 143]]) + page(612, 792, [[36, 47]])
    expect(parseRenderedType(xhtml).firstPageTopPt).toBe(132)
  })

  it('reports no start for a first page with no text', () => {
    expect(parseRenderedType(page(612, 792, [])).firstPageTopPt).toBeNull()
  })

  it('reports where the body text block starts, not the leftmost word', () => {
    // A centred title says nothing about where the body sits; the modal line
    // start does. This is how an indented master is told from a normal one.
    const xhtml = indented(612, 792, [
      [300, 10],
      ...Array.from({ length: 12 }, () => [90, 11] as [number, number]),
    ])
    expect(parseRenderedType(xhtml).bodyLeftPt).toBe(90)
  })

  it('joins a bullet to the line it introduces', () => {
    // A bullet is set in a different face and lands a fraction of a point off
    // its text. Counted as its own line, the plain lines below would outvote
    // it and the measure would report 90 rather than the 72 a reader sees as
    // the edge of the list.
    const bulleted = Array.from({ length: 7 }, (_, i) => [
      `<word xMin="72" yMin="${100 + i * 14}.4" xMax="80" yMax="${111 + i * 14}">.</word>`,
      `<word xMin="90" yMin="${100 + i * 14}" xMax="300" yMax="${111 + i * 14}">w</word>`,
    ]).flat()
    const plain = Array.from(
      { length: 6 },
      (_, i) => `<word xMin="90" yMin="${300 + i * 14}" xMax="300" yMax="${311 + i * 14}">w</word>`,
    )
    const words = [...bulleted, ...plain]
    expect(
      parseRenderedType(`<page width="612" height="792">${words.join('')}</page>`).bodyLeftPt,
    ).toBe(72)
  })
})
