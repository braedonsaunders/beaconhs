import { describe, expect, it } from 'vitest'
import { decodeSignatureDataUrl } from './signature-storage'

const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII='

describe('decodeSignatureDataUrl', () => {
  it('strictly decodes and fingerprints a valid PNG signature', () => {
    const result = decodeSignatureDataUrl(`data:image/png;base64,${PNG_1X1}`)
    expect(result.contentType).toBe('image/png')
    expect(result.extension).toBe('png')
    expect(result.body.length).toBeGreaterThan(8)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects active, malformed, and MIME-confused payloads', () => {
    expect(() => decodeSignatureDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toThrow()
    expect(() => decodeSignatureDataUrl('data:image/png;base64,not base64')).toThrow()
    expect(() => decodeSignatureDataUrl('data:image/jpeg;base64,iVBORw0KGgo=')).toThrow(
      'declared image type',
    )
  })
})
