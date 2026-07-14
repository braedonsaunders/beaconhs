import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  events: [] as string[],
  rows: [] as unknown[][],
  updateRows: [{ id: 'updated' }] as unknown[],
  withSuperAdmin: vi.fn(),
}))

vi.mock('@beaconhs/db/schema', () => ({
  platformSettings: {
    id: 'platform.id',
    email: 'platform.email',
    sms: 'platform.sms',
    updatedAt: 'platform.updated_at',
  },
  PLATFORM_SETTINGS_ID: '00000000-0000-0000-0000-000000000001',
  tenants: { id: 'tenant.id', settings: 'tenant.settings' },
}))

const tx = {
  insert: vi.fn(() => ({
    values: () => ({
      onConflictDoNothing: async () => {
        mocks.events.push('ensure-platform-row')
      },
    }),
  })),
  select: vi.fn(() => ({
    from: () => ({
      where: () => ({
        limit: () => ({
          for: async (lock: string) => {
            mocks.events.push(`select-${lock}`)
            return mocks.rows.shift() ?? []
          },
        }),
      }),
    }),
  })),
  update: vi.fn(() => ({
    set: () => ({
      where: () => ({
        returning: async () => {
          mocks.events.push('update')
          return mocks.updateRows
        },
      }),
    }),
  })),
}

vi.mock('@beaconhs/db', () => ({
  db: {},
  withSuperAdmin: mocks.withSuperAdmin,
}))

import { savePlatformEmailSettings, saveTenantEmailSettings } from './email-config'
import { savePlatformSmsSettings, saveTenantSmsSettings } from './sms-config'

const context = { tenantId: 'tenant-1' } as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.events.length = 0
  mocks.rows.length = 0
  mocks.updateRows = [{ id: 'updated' }]
  mocks.withSuperAdmin.mockImplementation(async (_db, callback) => callback(tx))
})

describe('provider configuration persistence locking', () => {
  it.each([
    {
      label: 'email',
      platformRow: { email: { mode: 'tenant_optional' } },
      save: () =>
        saveTenantEmailSettings(context, {
          enabled: false,
          provider: 'sendgrid',
          fromName: '',
          fromEmail: '',
          replyTo: '',
          mailgunDomain: '',
          mailgunRegion: 'us',
          smtpHost: '',
          smtpPort: 0,
          smtpSecure: false,
          smtpUsername: '',
        }),
    },
    {
      label: 'SMS',
      platformRow: { sms: { mode: 'tenant_optional' } },
      save: () =>
        saveTenantSmsSettings(context, {
          enabled: false,
          provider: 'twilio',
          fromNumber: '',
          twilioAccountSid: '',
          vonageApiKey: '',
          plivoAuthId: '',
          telnyxMessagingProfileId: '',
        }),
    },
  ])('$label refuses to fake success when the active tenant row is missing', async (scenario) => {
    mocks.rows.push([scenario.platformRow], [])

    await expect(scenario.save()).rejects.toThrow('active tenant no longer exists')
    expect(mocks.events).toEqual(['ensure-platform-row', 'select-share', 'select-update'])
    expect(tx.update).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: 'email',
      row: { email: {} },
      save: () =>
        savePlatformEmailSettings({
          mode: 'disabled',
          enabled: false,
          provider: 'sendgrid',
          fromName: '',
          fromEmail: '',
          replyTo: '',
          mailgunDomain: '',
          mailgunRegion: 'us',
          smtpHost: '',
          smtpPort: 0,
          smtpSecure: false,
          smtpUsername: '',
        }),
    },
    {
      label: 'SMS',
      row: { sms: {} },
      save: () =>
        savePlatformSmsSettings({
          mode: 'disabled',
          enabled: false,
          provider: 'twilio',
          fromNumber: '',
          twilioAccountSid: '',
          vonageApiKey: '',
          plivoAuthId: '',
          telnyxMessagingProfileId: '',
        }),
    },
  ])('$label initializes and locks the singleton before merging a save', async (scenario) => {
    mocks.rows.push([scenario.row])

    await expect(scenario.save()).resolves.toMatchObject({ providerChanged: true })
    expect(mocks.events).toEqual(['ensure-platform-row', 'select-update', 'update'])
  })
})
