import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import type { EmailJobData } from '@beaconhs/jobs'

const mocks = vi.hoisted(() => ({
  inserted: [] as Record<string, unknown>[],
  categoryEnabled: vi.fn(),
  resolveDelivery: vi.fn(),
  sendVia: vi.fn(),
  updated: [] as Record<string, unknown>[],
  withSuperAdmin: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({ and: vi.fn(), eq: vi.fn() }))
vi.mock('@beaconhs/emails', () => ({ sendVia: mocks.sendVia }))
vi.mock('@beaconhs/db', () => ({ db: {}, withSuperAdmin: mocks.withSuperAdmin }))
vi.mock('@beaconhs/events', () => ({
  isNotificationCategoryEnabled: mocks.categoryEnabled,
}))
vi.mock('@beaconhs/db/schema', () => ({
  emailLog: {
    id: 'email_log.id',
    jobId: 'email_log.job_id',
    status: 'email_log.status',
    subject: 'email_log.subject',
    recipientPrimary: 'email_log.recipient_primary',
  },
  reportRunDeliveries: { id: 'report_run_deliveries.id' },
  reportRuns: { id: 'report_runs.id' },
}))
vi.mock('../lib/resolve-email-transport', () => ({
  resolveEmailDelivery: mocks.resolveDelivery,
  requireEmailTransport: (delivery: { kind: string; transport?: unknown }) => {
    if (delivery.kind === 'transport') return delivery.transport
    throw new Error('Email delivery is not configured: configure an enabled provider.')
  },
}))

const tx = {
  insert: vi.fn(() => ({
    values: (values: Record<string, unknown>) => {
      mocks.inserted.push(values)
      return { returning: async () => [{ id: 'log-1' }] }
    },
  })),
  update: vi.fn(() => ({
    set: (values: Record<string, unknown>) => {
      mocks.updated.push(values)
      return { where: async () => [] }
    },
  })),
}

function job(): Job<EmailJobData> {
  return {
    id: undefined,
    attemptsMade: 0,
    opts: { attempts: 3 },
    data: {
      to: 'operator@example.com',
      subject: 'Safety alert',
      html: '<p>Alert</p>',
      text: 'Alert',
      meta: { tenantId: 'tenant-1', category: 'incident' },
    },
  } as unknown as Job<EmailJobData>
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.inserted.length = 0
  mocks.updated.length = 0
  mocks.withSuperAdmin.mockImplementation(async (_db, callback) => callback(tx))
  mocks.sendVia.mockResolvedValue({ id: 'provider-message-1' })
  mocks.categoryEnabled.mockResolvedValue(true)
})

describe('email worker provider policy', () => {
  it('records a platform-suppressed send without contacting a provider', async () => {
    mocks.resolveDelivery.mockResolvedValue({ kind: 'suppressed' })
    const { processEmail } = await import('./email')

    await expect(processEmail(job())).resolves.toBeUndefined()

    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(mocks.inserted[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'Email delivery is disabled by the platform administrator.',
      meta: expect.objectContaining({ provider: 'suppressed', suppressed: true }),
    })
  })

  it('records and retries an unconfigured provider instead of reporting success', async () => {
    mocks.resolveDelivery.mockResolvedValue({ kind: 'unconfigured' })
    const { processEmail } = await import('./email')

    await expect(processEmail(job())).rejects.toThrow('not configured')

    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(mocks.inserted[0]).toMatchObject({
      status: 'queued',
      meta: expect.objectContaining({ provider: 'unconfigured' }),
    })
    expect(mocks.updated).toContainEqual(
      expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('not configured'),
      }),
    )
  })

  it('records the provider message id only after the resolved transport succeeds', async () => {
    const transport = {
      provider: 'sendgrid' as const,
      apiKey: 'SG.secret',
      from: 'BeaconHS <beacon@example.com>',
    }
    mocks.resolveDelivery.mockResolvedValue({
      kind: 'transport',
      transport,
      source: 'platform',
    })
    const { processEmail } = await import('./email')

    await expect(processEmail(job())).resolves.toBeUndefined()

    expect(mocks.sendVia).toHaveBeenCalledWith(
      transport,
      expect.objectContaining({ to: 'operator@example.com', subject: 'Safety alert' }),
    )
    expect(mocks.updated).toContainEqual({
      status: 'sent',
      providerMessageId: 'provider-message-1',
      sentAt: expect.any(Date),
    })
  })

  it('suppresses a queued automatic email when its tenant category was turned off', async () => {
    const queued = job()
    queued.data.meta = {
      tenantId: 'tenant-1',
      category: 'compliance',
      automaticNotification: true,
    }
    mocks.categoryEnabled.mockResolvedValue(false)
    const { processEmail } = await import('./email')

    await expect(processEmail(queued)).resolves.toBeUndefined()

    expect(mocks.resolveDelivery).not.toHaveBeenCalled()
    expect(mocks.sendVia).not.toHaveBeenCalled()
    expect(mocks.inserted[0]).toMatchObject({
      status: 'failed',
      errorMessage: 'Automatic compliance notifications are disabled for this workspace.',
      meta: expect.objectContaining({
        suppressed: true,
        suppression: 'tenant-category',
      }),
    })
  })
})
