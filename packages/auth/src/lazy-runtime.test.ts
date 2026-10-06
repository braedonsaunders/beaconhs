import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const instance = { api: { getSession: vi.fn() }, handler: vi.fn() }
  const state: {
    options?: {
      emailAndPassword?: {
        sendResetPassword?: (args: {
          user: { id: string; email: string }
          url: string
        }) => Promise<void>
      }
      hooks?: { after?: (ctx: unknown) => Promise<unknown> }
      databaseHooks?: {
        verification?: {
          create?: {
            before?: (
              data: { expiresAt: Date },
              ctx: {
                path: string
                body?: { callbackURL?: string; metadata?: Record<string, unknown> }
              },
            ) => Promise<{ data: { expiresAt: Date } } | undefined>
          }
        }
      }
    }
    magicLinkOptions?: {
      expiresIn?: number
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
    inviteGrantFromCallbackURL: vi.fn(),
    verifyInviteGrant: vi.fn(),
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
  inviteGrantFromCallbackURL: mocks.inviteGrantFromCallbackURL,
  verifyInviteGrant: mocks.verifyInviteGrant,
}))

const originalEnv = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  process.env = { ...originalEnv }
  mocks.enqueueEmail.mockResolvedValue({ id: 'job-1' })
  mocks.sendVia.mockResolvedValue({ id: 'smtp-1' })
  mocks.inviteGrantFromCallbackURL.mockReturnValue(null)
  mocks.verifyInviteGrant.mockReturnValue({ ok: false, reason: 'invalid' })
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
    expect(mocks.state.magicLinkOptions?.expiresIn).toBe(15 * 60)
  })

  it('extends only server-authorized invitation credentials and emails the seven-day lifetime', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.BETTER_AUTH_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.NODE_ENV = 'production'
    const { getAuth, withAuthEmailContext } = await import('./server')
    getAuth()
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000
    mocks.inviteGrantFromCallbackURL.mockReturnValue('signed-grant')
    mocks.verifyInviteGrant.mockReturnValue({
      ok: true,
      payload: { tenantId: 'tenant-1', userId: 'user-1', expiresAt },
    })
    const before = mocks.state.options?.databaseHooks?.verification?.create?.before
    const data = { expiresAt: new Date(Date.now() + 900000) }
    const request = {
      path: '/sign-in/magic-link',
      body: { callbackURL: '/invite/accept?grant=signed-grant' },
    }
    await expect(before?.(data, request)).resolves.toBeUndefined()
    await withAuthEmailContext({ tenantId: 'wrong-tenant', userId: 'user-1' }, async () => {
      await expect(before?.(data, request)).resolves.toBeUndefined()
    })
    await withAuthEmailContext({ tenantId: 'tenant-1', userId: 'user-1' }, async () => {
      await expect(before?.(data, request)).resolves.toEqual({
        data: { expiresAt: new Date(expiresAt) },
      })
      await expect(before?.(data, { path: '/request-password-reset' })).resolves.toBeUndefined()
      await mocks.state.magicLinkOptions?.sendMagicLink?.({
        email: 'operator@example.com',
        url: 'http://localhost:3000/api/auth/magic-link/verify?token=secret&callbackURL=%2Finvite%2Faccept%3Fgrant%3Dsigned-grant',
        metadata: { flow: 'invite', tenantName: 'Site team' },
      })
    })
    expect(mocks.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "You're invited to Site team in BeaconHS",
        text: expect.stringContaining('expires in 7 days'),
        html: expect.stringContaining('expires in 7 days'),
      }),
    )
  })

  it('keeps public sign-in links short even when invitation metadata is spoofed', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.BETTER_AUTH_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.NODE_ENV = 'production'
    const { getAuth } = await import('./server')
    getAuth()
    await mocks.state.magicLinkOptions?.sendMagicLink?.({
      email: 'operator@example.com',
      url: 'http://localhost:3000/api/auth/magic-link/verify?token=secret',
      metadata: { flow: 'invite', tenantName: 'Spoofed team' },
    })
    expect(mocks.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Sign in to BeaconHS',
        text: expect.stringContaining('expires in 15 minutes'),
      }),
    )
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
      user: { id: 'user-1', email: 'operator@example.com' },
      url: 'https://app.example.test/reset?token=secret-token',
    })

    expect(mocks.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'operator@example.com',
        subject: 'Reset your BeaconHS password',
        meta: { category: 'auth', userId: 'user-1' },
      }),
    )
    expect(mocks.sendVia).not.toHaveBeenCalled()
  })

  it('attributes an auth email to the tenant-scoped operation that requested it', async () => {
    process.env.DATABASE_URL = 'postgresql://app:secret@db.example.test/beaconhs'
    process.env.BETTER_AUTH_SECRET = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    process.env.NODE_ENV = 'production'
    const { getAuth, withAuthEmailContext } = await import('./server')
    getAuth()

    const sendResetPassword = mocks.state.options?.emailAndPassword?.sendResetPassword
    await withAuthEmailContext({ tenantId: 'tenant-1', userId: 'user-1' }, () =>
      sendResetPassword!({
        user: { id: 'user-1', email: 'operator@example.com' },
        url: 'https://app.example.test/reset?token=secret-token',
      }),
    )

    expect(mocks.enqueueEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: { category: 'auth', tenantId: 'tenant-1', userId: 'user-1' },
      }),
    )
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
