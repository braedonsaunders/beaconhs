import { describe, expect, it } from 'vitest'

// The full composer needs Chromium (it renders the cover and contents through
// the HTML pipeline), so it is exercised end-to-end against a real book rather
// than here. Settings resolution is pinned next to its implementation in
// @beaconhs/db, which the worker and the book builder both read.

describe('book paging with sections', () => {
  // The contents must point at real pages. Sections occupy a divider page of
  // their own, so they shift everything after them — getting this wrong makes
  // every entry in a 196-document manual wrong by the number of dividers.
  function pages(
    nodes: ({ kind: 'section' } | { kind: 'document'; pageCount: number })[],
    ownPage: boolean,
  ): number[] {
    let cursor = 1
    return nodes.map((node) => {
      const page = cursor
      cursor += node.kind === 'section' ? 1 : (ownPage ? 1 : 0) + Math.max(1, node.pageCount)
      return page
    })
  }

  it('counts a divider as one page', () => {
    expect(
      pages(
        [
          { kind: 'section' },
          { kind: 'document', pageCount: 2 },
          { kind: 'section' },
          { kind: 'document', pageCount: 3 },
        ],
        false,
      ),
    ).toEqual([1, 2, 4, 5])
  })

  it('adds the control sheet only when it takes its own page', () => {
    const nodes = [
      { kind: 'document' as const, pageCount: 1 },
      { kind: 'document' as const, pageCount: 1 },
    ]
    // Riding on the document: one page each.
    expect(pages(nodes, false)).toEqual([1, 2])
    // Its own sheet: two pages each.
    expect(pages(nodes, true)).toEqual([1, 3])
  })

  it('treats a zero-page document as occupying one page', () => {
    // A member that reports no pages must not collapse the numbering of
    // everything after it.
    expect(
      pages(
        [
          { kind: 'document', pageCount: 0 },
          { kind: 'document', pageCount: 1 },
        ],
        false,
      ),
    ).toEqual([1, 2])
  })
})
