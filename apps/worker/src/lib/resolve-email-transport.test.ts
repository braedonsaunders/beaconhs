import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as { email: unknown }[],
  select: vi.fn(),
  withSuperAdmin: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@beaconhs/db/schema', () => ({
  platformSettings: { id: 'id', email: 'email' },
  PLATFORM_SETTINGS_ID: 'platform',
  tenants: { id: 'id', settings: 'settings' },
}))
vi.mock('@beaconhs/db', () => ({ db: {}, withSuperAdmin: mocks.withSuperAdmin }))

const tx = {
  select: mocks.select,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rows.length = 0
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          const row = mocks.rows.shift()
          return row ? [row] : []
        },
      }),
    }),
  }))
  mocks.withSuperAdmin.mockImplementation(async (_db, callback) => callback(tx))
})

import { requireEmailTransport, resolveEmailDelivery } from './resolve-email-transport'

describe('requireEmailTransport', () => {
  it('returns a database-resolved transport', () => {
    const transport = {
      provider: 'sendgrid' as const,
      apiKey: 'SG.test',
      from: 'BeaconHS <beacon@example.test>',
    }
    expect(requireEmailTransport({ kind: 'transport', transport, source: 'platform' })).toBe(
      transport,
    )
  })

  it('fails explicitly when no provider is configured', () => {
    expect(() => requireEmailTransport({ kind: 'unconfigured' })).toThrow(
      'configure an enabled platform or tenant provider',
    )
  })

  it('does not turn the platform kill switch into a provider fallback', () => {
    expect(() => requireEmailTransport({ kind: 'suppressed' })).toThrow(
      'disabled by the platform administrator',
    )
  })

  it('reads the platform policy for every job so a kill-switch change is immediate', async () => {
    mocks.rows.push({ email: { mode: 'disabled' } }, { email: null })

    await expect(resolveEmailDelivery(null)).resolves.toEqual({ kind: 'suppressed' })
    await expect(resolveEmailDelivery(null)).resolves.toEqual({ kind: 'unconfigured' })
    expect(mocks.select).toHaveBeenCalledTimes(2)
    expect(mocks.withSuperAdmin).toHaveBeenCalledTimes(2)
  })
})
