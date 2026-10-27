import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ redis: vi.fn() }))

vi.mock('ioredis', () => ({
  Redis: class MockRedis {
    constructor(...args: unknown[]) {
      mocks.redis(...args)
    }
  },
}))

import { getBlockingConnection, getConnection, redisReconnectOnError } from './connection'

describe('redisReconnectOnError', () => {
  it('reconnects and resends after a READONLY replica rejection (Sentinel failover)', () => {
    expect(
      redisReconnectOnError(new Error("READONLY You can't write against a read only replica.")),
    ).toBe(2)
  })

  it('does not reconnect for unrelated command errors', () => {
    expect(redisReconnectOnError(new Error('ERR unknown command'))).toBe(false)
    expect(redisReconnectOnError(new Error('WRONGTYPE Operation against a key'))).toBe(false)
    expect(redisReconnectOnError(new Error('readonly mode is off'))).toBe(false)
  })

  it('is wired into both shared connections', () => {
    getConnection()
    getBlockingConnection()
    expect(mocks.redis).toHaveBeenCalledTimes(2)
    for (const call of mocks.redis.mock.calls) {
      const options = call[1] as { reconnectOnError?: unknown }
      expect(options.reconnectOnError).toBe(redisReconnectOnError)
    }
  })
})
