import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizeProse } from './i18n-source-audit'

describe('normalizeProse', () => {
  it('decodes source entities exactly once', () => {
    expect(normalizeProse('Safety &amp; Health &lt;Guide&gt;')).toBe('Safety & Health <Guide>')
    expect(normalizeProse('&amp;lt;literal&amp;gt;')).toBe('&lt;literal&gt;')
  })
})

describe('generated message catalogues', () => {
  it('contain no duplicate generated-message keys', () => {
    for (const locale of ['en', 'fr', 'es']) {
      const raw = readFileSync(
        new URL(`../../../packages/i18n/src/messages/${locale}.json`, import.meta.url),
        'utf8',
      )
      const generated = raw.slice(raw.indexOf('"Generated": {'))
      const keys = [...generated.matchAll(/^    "(m_[0-9a-f]+)":/gm)].map((match) => match[1])
      expect(new Set(keys).size, `${locale} contains duplicate generated keys`).toBe(keys.length)
    }
  })
})
