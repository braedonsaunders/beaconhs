import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  redis: vi.fn(),
  queue: vi.fn(),
  queueAdd: vi.fn(async (..._args: unknown[]) => ({ id: 'job-id' })),
  queueEvents: vi.fn(),
}))

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    constructor(...args: unknown[]) {
      mocks.redis(...args)
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

  it('creates and reuses one Redis connection and one queue on runtime use', async () => {
    process.env.REDIS_URL = 'redis://runtime.example.test:6379'
    const jobs = await import('./index')

    const first = jobs.getConnection()
    const second = jobs.getConnection()
    expect(second).toBe(first)
    expect(mocks.redis).toHaveBeenCalledTimes(1)
    expect(mocks.redis).toHaveBeenCalledWith('redis://runtime.example.test:6379', {
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
  })

  it('fails before creating a client when production Redis is unconfigured', async () => {
    delete process.env.REDIS_URL
    process.env.NODE_ENV = 'production'
    const jobs = await import('./index')

    expect(() => jobs.getConnection()).toThrow('[jobs] REDIS_URL is required.')
    expect(mocks.redis).not.toHaveBeenCalled()
  })
})
