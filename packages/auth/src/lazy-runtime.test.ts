import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const instance = { api: { getSession: vi.fn() }, handler: vi.fn() }
  const state: { options?: { hooks?: { after?: (ctx: unknown) => Promise<unknown> } } } = {}
  return {
    betterAuth: vi.fn((options) => {
      state.options = options
      return instance
    }),
    instance,
    magicLink: vi.fn(() => ({ id: 'magic-link' })),
    nextCookies: vi.fn(() => ({ id: 'next-cookies' })),
    pool: vi.fn(),
    state,
  }
})

vi.mock('better-auth', () => ({ betterAuth: mocks.betterAuth }))
vi.mock('better-auth/plugins', () => ({ magicLink: mocks.magicLink }))
vi.mock('better-auth/next-js', () => ({ nextCookies: mocks.nextCookies }))
vi.mock('pg', () => ({
  Pool: class MockPool {
    constructor(...args: unknown[]) {
      mocks.pool(...args)
    }
  },
}))
vi.mock('./invites', () => ({
  acceptInviteAfterMagicLink: vi.fn(),
  inviteGrantFromCallbackURL: vi.fn(),
  INVITE_LINK_TTL_SECONDS: 900,
}))

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('lazy auth runtime', () => {
  it('imports without constructing a pool, plugins, or Better Auth', async () => {
    await import('./server')

    expect(mocks.pool).not.toHaveBeenCalled()
    expect(mocks.magicLink).not.toHaveBeenCalled()
    expect(mocks.nextCookies).not.toHaveBeenCalled()
    expect(mocks.betterAuth).not.toHaveBeenCalled()
  })

  it('constructs and reuses one configured auth instance on runtime use', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.BETTER_AUTH_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.BETTER_AUTH_URL = 'https://app.example.test'
    process.env.NODE_ENV = 'production'
    const { getAuth } = await import('./server')

    const first = getAuth()
    const second = getAuth()
    expect(first).toBe(mocks.instance)
    expect(second).toBe(first)
    expect(mocks.pool).toHaveBeenCalledTimes(1)
    expect(mocks.pool).toHaveBeenCalledWith({
      connectionString: 'postgresql://app:secret@db.example.test/beaconhs',
    })
    expect(mocks.magicLink).toHaveBeenCalledTimes(1)
    expect(mocks.nextCookies).toHaveBeenCalledTimes(1)
    expect(mocks.betterAuth).toHaveBeenCalledTimes(1)
  })

  it('returns a valid no-op result from the global after hook', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.BETTER_AUTH_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.NODE_ENV = 'production'
    const { getAuth } = await import('./server')
    getAuth()

    const after = mocks.state.options?.hooks?.after
    expect(after).toBeTypeOf('function')
    await expect(after?.({ path: '/get-session', context: { newSession: null } })).resolves.toEqual(
      {},
    )
  })

  it('fails closed at runtime when production configuration is missing', async () => {
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET
    process.env.NODE_ENV = 'production'
    const { getAuth } = await import('./server')

    expect(() => getAuth()).toThrow('[auth] DATABASE_URL is required.')
    expect(mocks.pool).not.toHaveBeenCalled()
    expect(mocks.betterAuth).not.toHaveBeenCalled()
  })

  it('rejects a weak production signing secret before constructing auth', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.BETTER_AUTH_SECRET = 'too-short'
    process.env.NODE_ENV = 'production'
    const { getAuth } = await import('./server')

    expect(() => getAuth()).toThrow(
      '[auth] BETTER_AUTH_SECRET must contain at least 32 characters in production.',
    )
    expect(mocks.pool).not.toHaveBeenCalled()
    expect(mocks.betterAuth).not.toHaveBeenCalled()
  })
})
