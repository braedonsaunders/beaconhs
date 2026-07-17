import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const printing = readFileSync(new URL('./direct-printing.ts', import.meta.url), 'utf8')
const env = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8')

describe('tenant direct-printing contract', () => {
  it('stores all direct providers under tenant settings with sealed credentials', () => {
    for (const provider of [
      'cardpresso-wps',
      'zebra-browser-print',
      'evolis-sdk',
      'hid-fargo-sdk',
    ]) {
      expect(printing).toContain(`'${provider}'`)
    }
    expect(printing).toContain('sealSecret(')
    expect(printing).toContain('settings: { ...settings, printing: { providers } }')
  })

  it('has no cardPresso environment fallback', () => {
    expect(printing).not.toContain('CARDPRESSO_WPS_')
    expect(env).not.toContain('CARDPRESSO_WPS_')
  })

  it('sends bridge jobs through bounded SSRF-protected HTTPS egress', () => {
    expect(printing).toContain("url.protocol !== 'https:'")
    expect(printing).toContain('await secureFetch(config.url')
    expect(printing).toContain('authorization: `Bearer ${token}`')
    expect(printing).toContain('maxRequestBytes: 16 * 1024 * 1024')
  })
})
