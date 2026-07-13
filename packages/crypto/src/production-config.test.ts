import { afterEach, describe, expect, it, vi } from 'vitest'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
  vi.resetModules()
})

describe('production secret configuration', () => {
  it('rejects missing and weak secret-sealing keys', async () => {
    process.env.NODE_ENV = 'production'
    delete process.env.BETTER_AUTH_SECRET
    let crypto = await import('./index')

    expect(() => crypto.sealSecret('value')).toThrow(
      '[crypto] BETTER_AUTH_SECRET must contain at least 32 characters in production',
    )

    vi.resetModules()
    process.env.BETTER_AUTH_SECRET = 'too-short'
    crypto = await import('./index')
    expect(() => crypto.sealSecret('value')).toThrow(
      '[crypto] BETTER_AUTH_SECRET must contain at least 32 characters in production',
    )
  })
})
