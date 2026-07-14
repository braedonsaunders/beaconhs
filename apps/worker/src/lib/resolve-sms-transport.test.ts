import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as { sms: unknown }[],
  select: vi.fn(),
  withSuperAdmin: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({ eq: vi.fn() }))
vi.mock('@beaconhs/db/schema', () => ({
  platformSettings: { id: 'id', sms: 'sms' },
  PLATFORM_SETTINGS_ID: 'platform',
  tenants: { id: 'id', settings: 'settings' },
}))
vi.mock('@beaconhs/db', () => ({ db: {}, withSuperAdmin: mocks.withSuperAdmin }))

const tx = { select: mocks.select }

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

import { resolveSmsDelivery } from './resolve-sms-transport'

describe('resolveSmsDelivery', () => {
  it('reads platform policy for every job so a kill-switch change is immediate', async () => {
    mocks.rows.push({ sms: { mode: 'disabled' } }, { sms: null })

    await expect(resolveSmsDelivery(null)).resolves.toEqual({ kind: 'suppressed' })
    await expect(resolveSmsDelivery(null)).resolves.toEqual({ kind: 'unconfigured' })
    expect(mocks.select).toHaveBeenCalledTimes(2)
    expect(mocks.withSuperAdmin).toHaveBeenCalledTimes(2)
  })
})
