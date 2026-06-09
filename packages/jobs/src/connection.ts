import { Redis } from 'ioredis'
import type { ConnectionOptions } from 'bullmq'

export const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'

// BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
// for blocking consumers; we use the same connection for producers in dev.
//
// We share one ioredis instance across every Queue/Worker. Under TS 6, ioredis
// 5.11's `Redis` class is no longer nominally assignable to BullMQ's
// `ConnectionOptions` union (upstream type drift between the two packages), so
// we assert the type at the single source — this instance is only ever consumed
// as a BullMQ connection, which is its supported runtime shape.
export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
}) as unknown as ConnectionOptions
