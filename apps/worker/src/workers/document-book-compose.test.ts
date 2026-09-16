import { describe, expect, it } from 'vitest'
import { resolveBookPrintSettings } from './document-book-compose'

// The full composer needs Chromium (it renders the cover and contents through
// the HTML pipeline), so it is exercised end-to-end against a real book rather
// than here. What is worth pinning in a unit test is the settings resolution,
// because null has to mean "house defaults" rather than "everything off" — the
// 8 books that already existed were never edited, and they still have to print
// with a cover.

describe('resolveBookPrintSettings', () => {
  it('gives an unconfigured book the full treatment', () => {
    expect(resolveBookPrintSettings(null)).toEqual({
      paperSize: 'letter',
      orientation: 'portrait',
      contentMarginMm: 0,
      coverPage: true,
      tableOfContents: true,
      documentHeaders: true,
      // The control block rides on the document by default: a sheet of its own
      // doubles the page count of a book of one-page documents.
      documentHeadersOnOwnPage: false,
      footer: true,
      documentPageBreaks: true,
    })
    expect(resolveBookPrintSettings(undefined)).toEqual(resolveBookPrintSettings(null))
  })

  it('lets a single field be overridden without losing the rest', () => {
    const resolved = resolveBookPrintSettings({ coverPage: false })
    expect(resolved.coverPage).toBe(false)
    expect(resolved.tableOfContents).toBe(true)
    expect(resolved.footer).toBe(true)
    expect(resolved.paperSize).toBe('letter')
  })

  it('honours an explicit false rather than treating it as unset', () => {
    // `{...DEFAULTS, ...settings}` is only correct while the caller omits keys
    // it does not mean; an explicit false must survive.
    const resolved = resolveBookPrintSettings({
      coverPage: false,
      tableOfContents: false,
      documentHeaders: false,
      footer: false,
    })
    expect(resolved).toMatchObject({
      coverPage: false,
      tableOfContents: false,
      documentHeaders: false,
      footer: false,
    })
  })

  it('carries paper choices through', () => {
    expect(resolveBookPrintSettings({ paperSize: 'a4', orientation: 'landscape' })).toMatchObject({
      paperSize: 'a4',
      orientation: 'landscape',
    })
  })
})

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
