import { Redis } from 'ioredis'

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379'

let client: Redis | null = null

function rateLimitClient() {
  client ??= new Redis(redisUrl, {
    connectTimeout: 1_000,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  })
  return client
}

function windowBucket(windowSeconds: number, nowMs = Date.now()) {
  return Math.floor(nowMs / (windowSeconds * 1_000))
}

function redisKey(key: string, windowSeconds: number, nowMs = Date.now()) {
  const encoded = Buffer.from(key).toString('base64url')
  return `rate-limit:${encoded}:${windowBucket(windowSeconds, nowMs)}`
}

export type RateLimitStatus = {
  allowed: boolean
  count: number
  remaining: number
  resetAt: Date
}

export type RateLimitInput = {
  key: string
  limit: number
  windowSeconds: number
}

export async function getRateLimitStatus(input: RateLimitInput): Promise<RateLimitStatus> {
  const raw = await rateLimitClient().get(redisKey(input.key, input.windowSeconds))
  const count = raw ? Number(raw) : 0
  const currentBucket = windowBucket(input.windowSeconds)
  return {
    allowed: count < input.limit,
    count,
    remaining: Math.max(0, input.limit - count),
    resetAt: new Date((currentBucket + 1) * input.windowSeconds * 1_000),
  }
}

export async function recordRateLimitFailure(input: RateLimitInput): Promise<RateLimitStatus> {
  const key = redisKey(input.key, input.windowSeconds)
  const redis = rateLimitClient()
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, input.windowSeconds)
  const currentBucket = windowBucket(input.windowSeconds)
  return {
    allowed: count < input.limit,
    count,
    remaining: Math.max(0, input.limit - count),
    resetAt: new Date((currentBucket + 1) * input.windowSeconds * 1_000),
  }
}

export async function resetRateLimit(input: Pick<RateLimitInput, 'key' | 'windowSeconds'>) {
  await rateLimitClient().del(redisKey(input.key, input.windowSeconds))
}
