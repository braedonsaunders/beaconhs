import { describe, expect, it } from 'vitest'
import { normalizeProse } from './i18n-source-audit'

describe('normalizeProse', () => {
  it('decodes source entities exactly once', () => {
    expect(normalizeProse('Safety &amp; Health &lt;Guide&gt;')).toBe('Safety & Health <Guide>')
    expect(normalizeProse('&amp;lt;literal&amp;gt;')).toBe('&lt;literal&gt;')
  })
})
