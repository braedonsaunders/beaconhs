import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { NotifyJobData } from '@beaconhs/jobs'

const mocks = vi.hoisted(() => ({
  enqueueEmail: vi.fn(),
  enqueuePush: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  sendSmsVia: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@beaconhs/db', () => ({
  db: {},
  withTenant: async (
    _db: unknown,
    _tenantId: string,
    run: (tx: { select: typeof mocks.select; insert: typeof mocks.insert }) => Promise<unknown>,
  ) => run({ select: mocks.select, insert: mocks.insert }),
}))
vi.mock('@beaconhs/db/schema', () => ({
  notificationPreferences: {},
  notifications: {},
  people: {},
  smsLog: {},
  tenantNotificationPolicy: {},
  tenantNotificationSettings: {
    tenantId: 'tenant_notification_settings.tenant_id',
    category: 'tenant_notification_settings.category',
    enabled: 'tenant_notification_settings.enabled',
    channels: 'tenant_notification_settings.channels',
  },
  tenantUsers: {},
  users: {},
  webpushSubscriptions: {},
}))
vi.mock('@beaconhs/jobs', () => ({
  enqueueEmail: mocks.enqueueEmail,
  enqueuePush: mocks.enqueuePush,
  normalizeNotifyJobData: (data: NotifyJobData) => data,
}))
vi.mock('@beaconhs/sms', () => ({ sendSmsVia: mocks.sendSmsVia }))
vi.mock('../lib/resolve-sms-transport', () => ({
  resolveSmsDelivery: vi.fn(),
}))
vi.mock('../lib/app-base-url', () => ({ appBaseUrl: () => 'https://app.example.com' }))
vi.mock('../lib/escape-html', () => ({ escapeHtml: (value: string) => value }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.select.mockReturnValue({
    from: () => ({
      where: () => ({
        limit: async () => [{ enabled: false, channels: ['in_app', 'email'] }],
      }),
    }),
  })
})

describe('notification worker tenant category kill switch', () => {
  it('drops a queued automatic notification before creating or delivering any channel', async () => {
    const { processNotification } = await import('./notify')
    const job = {
      id: 'compliance-self|durable',
      data: {
        tenantId: 'tenant-1',
        userIds: ['user-1'],
        category: 'compliance',
        type: 'compliance.overdue',
        title: 'Weekly journal requirement is overdue',
        channels: ['in_app', 'email'],
      },
    } as unknown as Job<NotifyJobData>

    await expect(processNotification(job)).resolves.toBeUndefined()

    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.enqueueEmail).not.toHaveBeenCalled()
    expect(mocks.enqueuePush).not.toHaveBeenCalled()
    expect(mocks.sendSmsVia).not.toHaveBeenCalled()
  })
})
