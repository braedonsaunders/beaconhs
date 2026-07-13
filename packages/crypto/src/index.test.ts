import { beforeAll, describe, expect, it } from 'vitest'
import { sealSecret, unsealSecret } from './index'

beforeAll(() => {
  // Deterministic key material for the round-trip tests.
  process.env.BETTER_AUTH_SECRET = 'test-secret-for-crypto-suite'
})

describe('secret sealing', () => {
  it('round-trips a value', () => {
    const sealed = sealSecret('sk_live_swordfish')
    expect(sealed.ciphertext).toBeTruthy()
    expect(sealed.nonce).toBeTruthy()
    expect(unsealSecret(sealed)).toBe('sk_live_swordfish')
  })

  it('uses a fresh nonce each call (no deterministic ciphertext reuse)', () => {
    const a = sealSecret('same-input')
    const b = sealSecret('same-input')
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(unsealSecret(a)).toBe('same-input')
    expect(unsealSecret(b)).toBe('same-input')
  })

  it('returns null on a tampered ciphertext (GCM auth tag rejects it)', () => {
    const sealed = sealSecret('tamper-me')
    const raw = Buffer.from(sealed.ciphertext, 'base64')
    raw[0] = (raw[0] ?? 0) ^ 0xff
    expect(unsealSecret({ ciphertext: raw.toString('base64'), nonce: sealed.nonce })).toBeNull()
  })

  it('returns null on malformed input rather than throwing', () => {
    expect(unsealSecret({ ciphertext: 'not-base64!!', nonce: 'nope' })).toBeNull()
  })

  it('empty string round-trips', () => {
    expect(unsealSecret(sealSecret(''))).toBe('')
  })
})
