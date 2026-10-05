import { describe, expect, it } from 'vitest'
import { documentControlHeaderHtml } from './document-control-header'

describe('document header rendering', () => {
  it.each(['America/Toronto', 'Pacific/Auckland'])(
    'keeps entered calendar dates in their correct month in %s and escapes all editable fields',
    (timeZone) => {
      const html = documentControlHeaderHtml(
        {
          title: 'Procedure <title>',
          key: 'PROC <key>',
          category: 'Safety',
          type: 'Procedure',
          issuedAt: '2026-09-01',
          revisedAt: '2026-09-30',
          approvedBy: 'Peter <script>',
          version: 'Rev <B>',
        },
        '#0f172a',
        timeZone,
        false,
      )
      expect(html).toContain('September 1, 2026')
      expect(html).toContain('September 30, 2026')
      expect(html).toContain('Peter &lt;script&gt;')
      expect(html).toContain('Rev &lt;B&gt;')
      expect(html).not.toContain('<script>')
      expect(html).not.toContain('August 2026')
      expect(html).not.toContain('October 2026')
    },
  )
})
