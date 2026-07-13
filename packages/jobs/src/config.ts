const LOCAL_REDIS_URL = 'redis://localhost:6379'

/** Resolve Redis only when a queue/probe is actually used. */
export function getRedisUrl(): string {
  const value = process.env.REDIS_URL
  if (value) return value
  if (process.env.NODE_ENV !== 'production') return LOCAL_REDIS_URL
  throw new Error('[jobs] REDIS_URL is required.')
}
