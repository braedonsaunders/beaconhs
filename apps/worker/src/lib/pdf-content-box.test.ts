import { describe, expect, it } from 'vitest'
import { parseBboxXhtml } from './pdf-content-box'

function page(width: number, height: number, words: [number, number, number, number][]): string {
  const body = words
    .map(([x0, y0, x1, y1]) => `<word xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y1}">w</word>`)
    .join('')
  return `<page width="${width}" height="${height}">${body}</page>`
}

describe('parseBboxXhtml', () => {
  it('flips poppler top-left coordinates into PDF user space', () => {
    // poppler measures y downward from the top; PDF user space measures upward
    // from the bottom. Getting this backwards puts every crop at the wrong end
    // of the page.
    const [box] = parseBboxXhtml(page(612, 792, [[100, 200, 500, 700]]))
    expect(box).toEqual({
      left: 94, // 100 - padding
      right: 506, // 500 + padding
      bottom: 86, // 792 - 700 - padding
      top: 598, // 792 - 200 + padding
    })
  })

  it('spans every word on the page', () => {
    const [box] = parseBboxXhtml(
      page(612, 792, [
        [300, 300, 350, 320],
        [100, 200, 200, 240],
        [400, 600, 520, 640],
      ]),
    )
    expect(box!.left).toBe(94)
    expect(box!.right).toBe(526)
    expect(box!.bottom).toBe(146) // 792 - 640 - 6
    expect(box!.top).toBe(598) // 792 - 200 + 6
  })

  it('returns null for a page with no text', () => {
    // An image-only scan measures nothing. Cropping it to an empty box would
    // blank the page, so it has to fall back to rendering whole.
    expect(parseBboxXhtml(page(612, 792, []))).toEqual([null])
  })

  it('rejects a box too small to be a text block', () => {
    // A lone page number is not a content region; fitting it to the sheet would
    // blow one digit up to fill the page.
    expect(parseBboxXhtml(page(612, 792, [[300, 760, 320, 775]]))).toEqual([null])
  })

  it('clamps padding to the page edges', () => {
    const [box] = parseBboxXhtml(page(612, 792, [[0, 0, 612, 792]]))
    expect(box).toEqual({ left: 0, bottom: 0, right: 612, top: 792 })
  })

  it('reports one entry per page, in order', () => {
    const xhtml =
      page(612, 792, [[100, 100, 500, 700]]) +
      page(612, 792, []) +
      page(612, 792, [[50, 50, 560, 740]])
    const boxes = parseBboxXhtml(xhtml)
    expect(boxes).toHaveLength(3)
    expect(boxes[0]).not.toBeNull()
    expect(boxes[1]).toBeNull()
    expect(boxes[2]).not.toBeNull()
  })

  it('handles A4 pages, not just Letter', () => {
    const [box] = parseBboxXhtml(page(595.28, 841.89, [[80, 80, 515, 760]]))
    expect(box!.bottom).toBeCloseTo(841.89 - 760 - 6, 2)
    expect(box!.top).toBeCloseTo(841.89 - 80 + 6, 2)
  })
})
