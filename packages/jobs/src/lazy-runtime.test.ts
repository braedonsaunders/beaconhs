import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redis: vi.fn(),
  redisQuit: vi.fn(async () => 'OK'),
  redisDisconnect: vi.fn(),
  queue: vi.fn(),
  queueAdd: vi.fn(async (..._args: unknown[]) => ({ id: 'job-id' })),
  queueAddBulk: vi.fn(async (...args: unknown[]) => args[0] as unknown[]),
  queueGetRepeatableJobs: vi.fn(async () => [] as unknown[]),
  queueRemoveRepeatableByKey: vi.fn(async (..._args: unknown[]) => true),
  queueEvents: vi.fn(),
}))

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    constructor(...args: unknown[]) {
      mocks.redis(...args)
    }

    quit() {
      return mocks.redisQuit()
    }

    disconnect(...args: unknown[]) {
      return mocks.redisDisconnect(...args)
    }
  },
}))

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    constructor(...args: unknown[]) {
      mocks.queue(...args)
    }

    add(...args: unknown[]) {
      return mocks.queueAdd(...args)
    }

    addBulk(...args: unknown[]) {
      return mocks.queueAddBulk(...args)
    }

    getRepeatableJobs() {
      return mocks.queueGetRepeatableJobs()
    }

    removeRepeatableByKey(...args: unknown[]) {
      return mocks.queueRemoveRepeatableByKey(...args)
    }
  },
  QueueEvents: class MockQueueEvents {
    constructor(...args: unknown[]) {
      mocks.queueEvents(...args)
    }
  },
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

describe('lazy jobs runtime', () => {
  it('imports the full jobs barrel without creating Redis or BullMQ clients', async () => {
    await import('./index')

    expect(mocks.redis).not.toHaveBeenCalled()
    expect(mocks.queue).not.toHaveBeenCalled()
    expect(mocks.queueEvents).not.toHaveBeenCalled()
  })

  it('creates distinct bounded producer and resilient blocking connections lazily', async () => {
    process.env.REDIS_URL = 'redis://runtime.example.test:6379'
    const jobs = await import('./index')

    const first = jobs.getConnection()
    const second = jobs.getConnection()
    const blockingFirst = jobs.getBlockingConnection()
    const blockingSecond = jobs.getBlockingConnection()
    expect(second).toBe(first)
    expect(blockingSecond).toBe(blockingFirst)
    expect(blockingFirst).not.toBe(first)
    expect(mocks.redis).toHaveBeenCalledTimes(2)
    expect(mocks.redis).toHaveBeenNthCalledWith(1, 'redis://runtime.example.test:6379', {
      enableReadyCheck: false,
      maxRetriesPerRequest: 1,
    })
    expect(mocks.redis).toHaveBeenNthCalledWith(2, 'redis://runtime.example.test:6379', {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
    })

    const data = {
      to: 'worker@example.test',
      subject: 'Queued',
      html: '<p>Queued</p>',
      text: 'Queued',
    }
    await jobs.enqueueEmail(data)
    await jobs.enqueueEmail(data)
    expect(mocks.queue).toHaveBeenCalledTimes(1)
    expect(mocks.queueAdd).toHaveBeenCalledTimes(2)

    await jobs.closeJobConnections()
    expect(mocks.redisQuit).toHaveBeenCalledTimes(2)
    expect(mocks.redisDisconnect).not.toHaveBeenCalled()
    expect(jobs.getConnection()).not.toBe(first)
    expect(mocks.redis).toHaveBeenCalledTimes(3)
  })

  it('fans multiple recipients into private, idempotent single-recipient jobs', async () => {
    process.env.REDIS_URL = 'redis://runtime.example.test:6379'
    const jobs = await import('./index')

    await jobs.enqueueEmail(
      {
        to: [' First@Example.com ', 'first@example.com', 'second@example.com'],
        subject: 'Queued',
        html: '<p>Queued</p>',
        text: 'Queued',
      },
      { jobId: 'domain-event|one' },
    )

    expect(mocks.queueAdd).not.toHaveBeenCalled()
    expect(mocks.queueAddBulk).toHaveBeenCalledTimes(1)
    const [rawBatch] = mocks.queueAddBulk.mock.calls[0]!
    const batch = rawBatch as { data: { to: string }; opts: { jobId: string } }[]
    expect(batch).toHaveLength(2)
    expect(batch.map((entry) => entry.data.to)).toEqual(['First@Example.com', 'second@example.com'])
    const ids = batch.map((entry) => entry.opts.jobId)
    expect(new Set(ids)).toHaveLength(2)
    expect(ids.every((id: string) => /^email-fanout\|[a-f0-9]{64}$/.test(id))).toBe(true)
  })

  it('bounds notification fan-out and deduplicates sync runs across manual and scheduled producers', async () => {
    process.env.REDIS_URL = 'redis://runtime.example.test:6379'
    const jobs = await import('./index')
    const tenantId = '10000000-0000-4000-8000-000000000001'
    const connectionId = '20000000-0000-4000-8000-000000000001'

    await jobs.enqueueNotification(
      {
        tenantId,
        userIds: Array.from({ length: 251 }, (_, index) => `user-${index}`),
        category: 'incident',
        type: 'incident.created',
        title: 'Incident created',
      },
      { jobId: 'incident-notification|one' },
    )
    const [notificationBatch] = mocks.queueAddBulk.mock.calls[0]! as [
      Array<{ data: { userIds: string[] } }>,
    ]
    expect(notificationBatch).toHaveLength(2)
    expect(
      notificationBatch.map((entry: { data: { userIds: string[] } }) => entry.data.userIds.length),
    ).toEqual([250, 1])

    mocks.queueAddBulk.mockClear()
    await jobs.enqueueNotification({
      tenantId,
      userIds: Array.from({ length: 10_001 }, (_, index) => `large-user-${index}`),
      category: 'incident',
      type: 'incident.created',
      title: 'Large audience',
    })
    expect(mocks.queueAddBulk).toHaveBeenCalledTimes(2)
    expect(mocks.queueAddBulk.mock.calls.map(([batch]) => (batch as unknown[]).length)).toEqual([
      40, 1,
    ])

    await jobs.enqueueScheduled('sync_run', {
      kind: 'sync_run',
      tenantId,
      connectionId,
      trigger: 'manual',
    })
    await jobs.enqueueScheduled('sync_run', {
      kind: 'sync_run',
      tenantId,
      connectionId,
      trigger: 'scheduled',
    })
    const scheduledCalls = mocks.queueAdd.mock.calls.filter(([name]) => name === 'sync_run')
    expect(scheduledCalls).toHaveLength(2)
    expect(scheduledCalls[0]![2]).toEqual({
      jobId: `sync-run|${tenantId}|${connectionId}`,
      removeOnComplete: true,
      removeOnFail: true,
    })
    expect(scheduledCalls[1]![2]).toEqual(scheduledCalls[0]![2])

    await jobs.enqueueScheduled('manual:db_maintenance', {
      kind: 'db_maintenance',
      trigger: 'manual',
    })
    const maintenanceCall = mocks.queueAdd.mock.calls.find(
      ([name]) => name === 'manual:db_maintenance',
    )
    expect(maintenanceCall?.[2]).toEqual({ deduplication: { id: 'db-maintenance' } })
  })

  it('reconciles the exact scheduled registry without leaving shadow repeat definitions', async () => {
    process.env.REDIS_URL = 'redis://runtime.example.test:6379'
    mocks.queueGetRepeatableJobs.mockResolvedValueOnce([
      {
        key: 'legacy-generated-hash',
        name: 'tick:reports',
        pattern: '*/5 * * * *',
      },
      {
        key: 'tick-reports',
        name: 'tick:reports',
        pattern: '*/5 * * * *',
      },
      {
        key: 'tick-digest',
        name: 'tick:digest',
        pattern: 'old-pattern',
      },
    ])
    const { registerSchedules } = await import('./queues/scheduled')

    await registerSchedules()

    expect(mocks.queueRemoveRepeatableByKey.mock.calls).toEqual([
      ['legacy-generated-hash'],
      ['tick-digest'],
    ])
    const repeatOptions = mocks.queueAdd.mock.calls.map(
      ([, , options]) => (options as { repeat: { key: string; pattern: string } }).repeat,
    )
    expect(repeatOptions).toHaveLength(11)
    expect(new Set(repeatOptions.map(({ key }) => key))).toHaveLength(11)
    expect(repeatOptions).toContainEqual({
      key: 'tick-reports',
      pattern: '*/5 * * * *',
    })
    expect(repeatOptions).toContainEqual({
      key: 'tick-storage-object-deletion',
      pattern: '* * * * *',
    })
  })

  it('rejects invalid email data before creating Redis or BullMQ clients', async () => {
    const jobs = await import('./index')
    await expect(
      jobs.enqueueEmail({ to: 'not-an-email', subject: 'Queued', html: '', text: '' }),
    ).rejects.toThrow('invalid recipient')
    expect(mocks.redis).not.toHaveBeenCalled()
    expect(mocks.queue).not.toHaveBeenCalled()
  })

  it('rejects malformed rate-limit policy before allocating Redis state', async () => {
    const { consumeRateLimit, resetRateLimit } = await import('./rate-limit')
    await expect(
      consumeRateLimit({ key: 'public-api', limit: 0, windowSeconds: 60 }),
    ).rejects.toThrow(/limit/)
    await expect(resetRateLimit({ key: 'public-api', windowSeconds: 0 })).rejects.toThrow(/window/)
    expect(mocks.redis).not.toHaveBeenCalled()
  })

  it('fails before creating a client when production Redis is unconfigured', async () => {
    delete process.env.REDIS_URL
    process.env.NODE_ENV = 'production'
    const jobs = await import('./index')

    expect(() => jobs.getConnection()).toThrow('[jobs] REDIS_URL is required.')
    expect(mocks.redis).not.toHaveBeenCalled()
  })
})
