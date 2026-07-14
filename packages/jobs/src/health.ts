import { Redis } from 'ioredis'
import { getRedisUrl } from './config'

const DEFAULT_TIMEOUT_MS = 3_000

/**
 * Probe Redis with a short-lived connection that cannot queue commands or
 * retry forever. This is intentionally separate from BullMQ's long-lived
 * connection, whose infinite retry policy is correct for workers but wrong for
 * readiness checks.
 */
export async function assertRedisReady(options?: { url?: string; timeoutMs?: number }) {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error('Redis readiness timeout must be between 100 and 30000 ms')
  }
  const client = new Redis(options?.url ?? getRedisUrl(), {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  })
  // ioredis logs an "Unhandled error event" (including connection details)
  // when no listener exists. The awaited connect/ping calls still reject and
  // are handled by the caller; this listener only keeps probe output generic.
  client.on('error', () => undefined)

  try {
    await client.connect()
    const response = await client.ping()
    if (response !== 'PONG') throw new Error('Redis returned an unexpected readiness response')
  } finally {
    client.disconnect(false)
  }
}
