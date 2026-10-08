import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { NotifyJobData } from '@beaconhs/jobs'
import { eq } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({
  enqueueEmail: vi.fn(),
  enqueuePush: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  sendSmsVia: vi.fn(),
  resolveSmsDelivery: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
}))
vi.mock('@beaconhs/db', () => ({
  db: {},
  activePeopleWhere: vi.fn(),
  withTenant: async (
    _db: unknown,
    _tenantId: string,
    run: (tx: { select: typeof mocks.select; insert: typeof mocks.insert }) => Promise<unknown>,
  ) => run({ select: mocks.select, insert: mocks.insert }),
}))
vi.mock('@beaconhs/db/schema', () => ({
  hazidAssessments: { locked: 'hazid_assessments.locked' },
  hazidAssessmentSignatures: {},
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
  resolveSmsDelivery: mocks.resolveSmsDelivery,
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

type Row = Record<string, unknown>
function queries(...responses: Row[][]) {
  mocks.select.mockImplementation(() => {
    const rows = responses.shift() ?? []
    const query = {
      from: () => query,
      innerJoin: () => query,
      where: () => query,
      limit: async () => rows,
      then: (resolve: (rows: Row[]) => unknown) => Promise.resolve(rows).then(resolve),
    }
    return query
  })
  mocks.insert.mockImplementation(() => ({
    values: () => ({ onConflictDoNothing: async () => undefined }),
  }))
}
function signingJob(overrides: Partial<NotifyJobData> = {}) {
  return {
    id: 'hazid-signature-request|stable',
    data: {
      tenantId: 'tenant-1',
      userIds: ['user-1'],
      category: 'hazid_signing',
      type: 'hazid.signature_requested',
      title: 'Review and sign',
      body: 'Job hazards',
      linkPath: '/hazard-assessments/sign/signature-1?tenantId=tenant-1',
      data: { signatureId: 'signature-1', requestId: 'request-1' },
      delivery: 'immediate',
      channels: ['in_app', 'email', 'push'],
      ...overrides,
    },
  } as unknown as Job<NotifyJobData>
}
describe('manual signature notification delivery', () => {
  it.each([
    ['withdrawn or superseded', []],
    ['expired', [{ userId: 'user-1', expiresAt: new Date(0) }]],
    ['wrong recipient', [{ userId: 'other', expiresAt: new Date(Date.now() + 60000) }]],
  ])('drops a %s request before sending', async (_reason, rows) => {
    queries(rows as Row[])
    const { processNotification } = await import('./notify')
    await processNotification(signingJob())
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.enqueueEmail).not.toHaveBeenCalled()
    expect(mocks.enqueuePush).not.toHaveBeenCalled()
  })
  it('sends locked-JSA requests immediately despite digest/quiet hours, with durable retry identities', async () => {
    const hour = new Date().getUTCHours()
    const plan = () =>
      queries(
        [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60000) }],
        [{ enabled: true, channels: ['in_app', 'email', 'push'] }],
        [{ digestMode: 'daily', quietHours: { start: hour, end: (hour + 1) % 24 } }],
        [{ id: 'user-1', email: 'crew@example.com' }],
        [],
        [{ id: 'subscription-1', userId: 'user-1' }],
      )
    const { processNotification } = await import('./notify')
    plan()
    await processNotification(signingJob())
    plan()
    await processNotification(signingJob())
    expect(eq).not.toHaveBeenCalledWith('hazid_assessments.locked', false)
    expect(mocks.enqueueEmail).toHaveBeenCalledTimes(2)
    const [email, options] = mocks.enqueueEmail.mock.calls[0]!
    expect(email.text).toContain('https://app.example.com/hazard-assessments/sign/')
    expect(options.delay).toBeUndefined()
    expect(options.jobId).toBe(mocks.enqueueEmail.mock.calls[1]![1].jobId)
    expect(mocks.enqueuePush).toHaveBeenCalledTimes(2)
    expect(mocks.enqueuePush.mock.calls[0]![1]).toBe(mocks.enqueuePush.mock.calls[1]![1])
  })
  it('honours channel preferences for immediate requests', async () => {
    queries(
      [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60000) }],
      [{ enabled: true, channels: ['email', 'push'] }],
      [],
      [{ id: 'user-1', email: 'crew@example.com' }],
      [
        { userId: 'user-1', channel: 'email', enabled: false },
        { userId: 'user-1', channel: 'push', enabled: false },
      ],
      [{ id: 'subscription-1', userId: 'user-1' }],
    )
    const { processNotification } = await import('./notify')
    await processNotification(signingJob())
    expect(mocks.enqueueEmail).not.toHaveBeenCalled()
    expect(mocks.enqueuePush).not.toHaveBeenCalled()
  })
  it('includes the personal signing link in manually requested SMS', async () => {
    queries(
      [{ userId: 'user-1', expiresAt: new Date(Date.now() + 60000) }],
      [{ enabled: true, channels: ['sms'] }],
      [],
      [{ id: 'user-1', email: 'crew@example.com' }],
      [],
      [{ userId: 'user-1', phone: '+15555550123' }],
      [],
    )
    mocks.resolveSmsDelivery.mockResolvedValue({
      kind: 'transport',
      transport: { provider: 'twilio' },
    })
    mocks.sendSmsVia.mockResolvedValue({ id: 'sms-1' })
    const { processNotification } = await import('./notify')
    await processNotification(signingJob())
    expect(mocks.sendSmsVia).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        to: '+15555550123',
        body: expect.stringContaining(
          'https://app.example.com/hazard-assessments/sign/signature-1',
        ),
      }),
    )
  })
})
