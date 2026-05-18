import { Redis } from 'ioredis'

export const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'

// BullMQ requires `maxRetriesPerRequest: null` and `enableReadyCheck: false`
// for blocking consumers; we use the same connection for producers in dev.
export const connection = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
})
