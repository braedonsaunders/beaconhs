import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const instance = { api: { getSession: vi.fn() }, handler: vi.fn() }
  const state: {
    options?: {
      emailAndPassword?: {
        sendResetPassword?: (args: { user: { email: string }; url: string }) => Promise<void>
      }
      hooks?: { after?: (ctx: unknown) => Promise<unknown> }
    }
    magicLinkOptions?: {
      sendMagicLink?: (args: {
        email: string
        url: string
        metadata?: Record<string, unknown>
      }) => Promise<void>
    }
  } = {}
  return {
    betterAuth: vi.fn((options) => {
      state.options = options
      return instance
    }),
    enqueueEmail: vi.fn(),
    instance,
    magicLink: vi.fn((options) => {
      state.magicLinkOptions = options
      return { id: 'magic-link' }
    }),
    nextCookies: vi.fn(() => ({ id: 'next-cookies' })),
    pool: vi.fn(),
    sendVia: vi.fn(),
    state,
  }
})

vi.mock('better-auth', () => ({ betterAuth: mocks.betterAuth }))
vi.mock('better-auth/plugins', () => ({ magicLink: mocks.magicLink }))
vi.mock('better-auth/next-js', () => ({ nextCookies: mocks.nextCookies }))
vi.mock('@beaconhs/emails', () => ({ sendVia: mocks.sendVia }))
vi.mock('@beaconhs/jobs', () => ({ enqueueEmail: mocks.enqueueEmail }))
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
  mocks.enqueueEmail.mockResolvedValue({ id: 'job-1' })
  mocks.sendVia.mockResolvedValue({ id: 'smtp-1' })
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

  it('durably enqueues production password-reset email without provider environment state', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.BETTER_AUTH_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.NODE_ENV = 'production'
    const { getAuth } = await import('./server')
    getAuth()

    const sendResetPassword = mocks.state.options?.emailAndPassword?.sendResetPassword
    expect(sendResetPassword).toBeTypeOf('function')
    await sendResetPassword?.({
      user: { email: 'operator@example.com' },
      url: 'https://app.example.test/reset?token=secret-token',
    })

    expect(mocks.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'operator@example.com',
        subject: 'Reset your BeaconHS password',
        meta: { category: 'auth' },
      }),
    )
    expect(mocks.sendVia).not.toHaveBeenCalled()
  })

  it('uses the explicit loopback-only SMTP transport for local magic links', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.NODE_ENV = 'development'
    process.env.SMTP_HOST = 'localhost'
    process.env.SMTP_PORT = '1025'
    process.env.SMTP_FROM = 'BeaconHS <noreply@beaconhs.local>'
    const { getAuth } = await import('./server')
    getAuth()

    const sendMagicLink = mocks.state.magicLinkOptions?.sendMagicLink
    expect(sendMagicLink).toBeTypeOf('function')
    await sendMagicLink?.({
      email: 'operator@example.com',
      url: 'http://localhost:3000/api/auth/magic-link/verify?token=secret-token',
    })

    expect(mocks.sendVia).toHaveBeenCalledWith(
      {
        provider: 'smtp',
        mode: 'local-dev',
        host: 'localhost',
        port: 1025,
        secure: false,
        from: 'BeaconHS <noreply@beaconhs.local>',
      },
      expect.objectContaining({
        to: 'operator@example.com',
        subject: 'Sign in to BeaconHS',
      }),
    )
    expect(mocks.enqueueEmail).not.toHaveBeenCalled()
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
