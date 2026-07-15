import { describe, expect, it } from 'vitest'
import { pdfPageCssContent } from './pdf-page-content'

describe('pdfPageCssContent', () => {
  it('separates page counters from escaped literal content', () => {
    expect(
      pdfPageCssContent('<b>{{company}}</b> — {{page}} / {{pages}}', {
        company: 'Beacon "H&S"',
      }),
    ).toBe('"Beacon \\"H&S\\" — " counter(page) " / " counter(pages)')
  })

  it('removes text-only markup and resolves missing values without sentinels', () => {
    const content = pdfPageCssContent('<span>Page {{page}} {{missing}}</span>', {})
    expect(content).toBe('"Page " counter(page) " "')
    expect(content).not.toContain('\0')
  })

  it('does not expose executable content hidden in malformed markup', () => {
    const content = pdfPageCssContent('<p>Page {{page}}</p><script>steal()</script>', {})
    expect(content).toBe('"Page " counter(page)')
    expect(content).not.toContain('steal')
  })
})
