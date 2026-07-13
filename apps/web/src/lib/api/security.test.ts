import { describe, expect, it } from 'vitest'
import { parseApiBearerToken } from './token'
import { hasBuilderAppGrant } from './permissions'
import { apiIdempotencyRequestDigest } from './idempotency'

describe('public API security policy', () => {
  it('accepts only exact bounded API bearer tokens', () => {
    const token = `bhs_live_${'A'.repeat(43)}`
    expect(
      parseApiBearerToken(
        new Request('http://localhost/api/v1', { headers: { Authorization: `Bearer ${token}` } }),
      ),
    ).toBe(token)
    expect(
      parseApiBearerToken(
        new Request('http://localhost/api/v1', {
          headers: { Authorization: `Bearer ${token} trailing` },
        }),
      ),
    ).toBeNull()
    expect(
      parseApiBearerToken(
        new Request('http://localhost/api/v1', {
          headers: { Authorization: `Bearer bhs_live_${'A'.repeat(200)}` },
        }),
      ),
    ).toBeNull()
    expect(
      parseApiBearerToken(
        new Request('http://localhost/api/v1', { headers: { Authorization: 'Bearer other' } }),
      ),
    ).toBeNull()
  })

  it('keeps Builder apps fail-closed without an explicit template grant', () => {
    const templateId = '10000000-0000-4000-8000-000000000001'
    expect(hasBuilderAppGrant([], templateId)).toBe(false)
    expect(hasBuilderAppGrant(['20000000-0000-4000-8000-000000000002'], templateId)).toBe(false)
    expect(hasBuilderAppGrant([templateId], templateId)).toBe(true)
  })

  it('binds idempotency to method, path, and canonical JSON content', () => {
    const first = new Request('http://localhost/api/v1/incidents', { method: 'POST' })
    const same = new Request('http://localhost/api/v1/incidents', { method: 'POST' })
    const otherPath = new Request('http://localhost/api/v1/equipment', { method: 'POST' })
    expect(apiIdempotencyRequestDigest(first, { b: 2, a: 1 })).toBe(
      apiIdempotencyRequestDigest(same, { a: 1, b: 2 }),
    )
    expect(apiIdempotencyRequestDigest(first, { a: 1 })).not.toBe(
      apiIdempotencyRequestDigest(otherPath, { a: 1 }),
    )
  })
})
