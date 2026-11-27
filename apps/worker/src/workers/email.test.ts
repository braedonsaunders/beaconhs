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
vi.mock('@beaconhs/emails', () => ({
  sendVia: mocks.sendVia,
  // Faithful stand-in for the real identity rule (unit-tested in
  // @beaconhs/emails): per-send name shows as "<name> via BeaconHS" on the
  // configured address; per-send reply-to wins.
  resolveSendIdentity: (
    transport: { from: string; replyTo?: string },
    input: { senderName?: string; replyTo?: string },
  ) => ({
    from: input.senderName
      ? `${input.senderName} via BeaconHS <${transport.from.replace(/^.*<|>$/g, '')}>`
      : transport.from,
    replyTo: input.replyTo ?? transport.replyTo,
  }),
}))
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
  reportRunDeliveries: { id: 'report_run_deliveries.id', runId: 'report_run_deliveries.run_id' },
  reportRuns: { id: 'report_runs.id' },
  briefRunDeliveries: { id: 'brief_run_deliveries.id', runId: 'brief_run_deliveries.run_id' },
  briefRuns: { id: 'brief_runs.id' },
  tenantNotificationPolicy: {
    equipmentRemindersEnabled: 'policy.equipment_reminders_enabled',
    tenantId: 'policy.tenant_id',
  },
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

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
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

  it('persists the record subject linkage from the job meta', async () => {
    mocks.resolveDelivery.mockResolvedValue({ kind: 'suppressed' })
    const { processEmail } = await import('./email')
    const linked = job()
    linked.data.meta = {
      tenantId: 'tenant-1',
      category: 'training',
      subjectType: 'training_class',
      subjectId: '5b0f3c3e-2f7a-4d6e-9a51-0c6f4c1b2d3e',
    }

    await expect(processEmail(linked)).resolves.toBeUndefined()

    expect(mocks.inserted[0]).toMatchObject({
      subjectType: 'training_class',
      subjectId: '5b0f3c3e-2f7a-4d6e-9a51-0c6f4c1b2d3e',
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
      // A single-recipient job keeps the private-copy guarantee: the transport
      // is only allowed to address several people when the job carries several.
      { allowMultipleRecipients: false },
    )
    expect(mocks.updated).toContainEqual({
      status: 'sent',
      providerMessageId: 'provider-message-1',
      sentAt: expect.any(Date),
    })
  })

  it('logs and sends the per-send sender identity when the job carries one', async () => {
    const transport = {
      provider: 'sendgrid' as const,
      apiKey: 'SG.secret',
      from: 'BeaconHS <beacon@example.com>',
      replyTo: 'support@example.com',
    }
    mocks.resolveDelivery.mockResolvedValue({
      kind: 'transport',
      transport,
      source: 'platform',
    })
    const { processEmail } = await import('./email')
    const withSender = job()
    withSender.data.senderName = 'Jane Foreman'
    withSender.data.replyTo = 'jane@example.com'

    await expect(processEmail(withSender)).resolves.toBeUndefined()

    expect(mocks.inserted).toContainEqual(
      expect.objectContaining({
        fromAddr: 'Jane Foreman via BeaconHS <beacon@example.com>',
        replyToAddr: 'jane@example.com',
      }),
    )
    expect(mocks.sendVia).toHaveBeenCalledWith(
      transport,
      expect.objectContaining({ senderName: 'Jane Foreman', replyTo: 'jane@example.com' }),
      { allowMultipleRecipients: false },
    )
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

it('suppresses an already queued summary if a category inside it was paused', async () => {
  const queued = job()
  queued.data.meta = {
    tenantId: 'tenant-1',
    category: 'digest',
    automaticNotification: true,
    notificationCategories: ['incident', 'compliance'],
  }
  mocks.categoryEnabled.mockImplementation(
    async (_tx, _tenant, category) => category !== 'compliance',
  )
  const { processEmail } = await import('./email')
  await expect(processEmail(queued)).resolves.toBeUndefined()
  expect(mocks.sendVia).not.toHaveBeenCalled()
  expect(mocks.resolveDelivery).not.toHaveBeenCalled()
  expect(mocks.inserted[0]?.errorMessage).toBe(
    'Automatic compliance notifications are disabled for this workspace.',
  )
})

it('suppresses an already queued maintenance email after equipment reminders are paused', async () => {
  const { processEmail } = await import('./email')
  const paused = {
    ...tx,
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ enabled: false }] }) }),
    }),
  }
  mocks.withSuperAdmin.mockImplementation(async (_db, callback) => callback(paused))
  const queued = job()
  queued.data.meta = {
    tenantId: 'tenant-1',
    category: 'equipment',
    automaticNotification: true,
    equipmentMaintenanceReminder: true,
  }
  await processEmail(queued)
  expect(mocks.sendVia).not.toHaveBeenCalled()
  expect(mocks.inserted[0]).toMatchObject({
    status: 'failed',
    meta: { provider: 'suppressed', suppressed: true },
  })
})

it.each(['report', 'brief'] as const)(
  'finishes a %s when two recipients complete in overlapping transactions',
  async (kind) => {
    const schema = await import('@beaconhs/db/schema')
    const ledger = kind === 'report' ? schema.reportRunDeliveries : schema.briefRunDeliveries
    const runs = kind === 'report' ? schema.reportRuns : schema.briefRuns
    const { processEmail } = await import('./email')
    mocks.resolveDelivery.mockResolvedValue({
      kind: 'transport',
      transport: { provider: 'sendgrid', from: 'BeaconHS <beacon@example.com>' },
    })

    const recipients = [
      { tenantId: 'tenant-1', recipientEmail: 'first@example.com', status: 'enqueued' },
      { tenantId: 'tenant-1', recipientEmail: 'second@example.com', status: 'enqueued' },
    ]
    const runUpdates: Record<string, unknown>[] = []
    const bothUpdated = deferred()
    let deliveryWrites = 0
    let nextLock = Promise.resolve()

    // Model committed sibling rows and the current transaction's own write.
    // Each delivery is updated before either can inspect the run's outcomes.
    function deliveryTransaction(index: number) {
      let ownStatus: string | undefined
      let unlock: (() => void) | undefined
      return {
        ...tx,
        select: () => ({
          from: (table: unknown) => ({
            where: () =>
              table === runs
                ? {
                    for: async (strength: string) => {
                      expect(strength).toBe('no key update')
                      const previous = nextLock
                      const lock = deferred()
                      nextLock = lock.promise
                      await previous
                      unlock = lock.resolve
                    },
                  }
                : Object.assign(
                    Promise.resolve(
                      recipients.map((row, other) => ({
                        status: (index === other ? ownStatus : undefined) ?? row.status,
                        error: null,
                      })),
                    ),
                    { limit: async () => [recipients[index]] },
                  ),
          }),
        }),
        update: (table: unknown) => ({
          set: (values: Record<string, unknown>) => {
            if (table === ledger) {
              return {
                where: () => ({
                  returning: async () => {
                    ownStatus = String(values.status)
                    if (++deliveryWrites === recipients.length) bothUpdated.resolve()
                    await bothUpdated.promise
                    return [{ runId: 'shared-run' }]
                  },
                }),
              }
            }
            if (table === runs) {
              return { where: async () => runUpdates.push(values) }
            }
            return tx.update().set(values)
          },
        }),
        commit: () => {
          if (ownStatus) recipients[index]!.status = ownStatus
          unlock?.()
        },
      }
    }

    const transactions = recipients.map((_, index) => deliveryTransaction(index))
    let calls = 0
    mocks.withSuperAdmin.mockImplementation(async (_db, callback) => {
      // Two initial ledger reads, two log inserts, two log updates, then the
      // overlapping delivery transactions.
      const transaction = transactions[calls++ % recipients.length]!
      try {
        return await callback(transaction)
      } finally {
        transaction.commit()
      }
    })

    await Promise.all(
      recipients.map(({ recipientEmail }, index) => {
        const email = job()
        email.data.to = recipientEmail
        email.data.meta = {
          tenantId: 'tenant-1',
          [kind === 'report' ? 'reportRunDeliveryId' : 'briefRunDeliveryId']: `delivery-${index}`,
        }
        return processEmail(email)
      }),
    )

    expect(mocks.sendVia).toHaveBeenCalledTimes(2)
    expect(runUpdates).toEqual([{ status: 'succeeded', error: null, finishedAt: expect.any(Date) }])
  },
)
