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
