import { Redis } from 'ioredis'
import { getRedisUrl } from './config'

let client: Redis | null = null
let clientConnect: Promise<void> | null = null

async function rateLimitClient() {
  if (!client) {
    client = new Redis(getRedisUrl(), {
      connectTimeout: 1_000,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    })
    // Command callers surface failures with request-specific context. Keep an
    // idle connection failure from becoming an unhandled EventEmitter error.
    client.on('error', () => undefined)
  }
  if (client.status === 'wait') {
    clientConnect ??= client.connect().finally(() => {
      clientConnect = null
    })
  }
  if (clientConnect) await clientConnect
  return client
}

function windowBucket(windowSeconds: number, nowMs = Date.now()) {
  return Math.floor(nowMs / (windowSeconds * 1_000))
}

function redisKey(key: string, windowSeconds: number, nowMs = Date.now()) {
  const encoded = Buffer.from(key).toString('base64url')
  return `rate-limit:${encoded}:${windowBucket(windowSeconds, nowMs)}`
}

const INCREMENT_WITH_EXPIRY = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`

async function incrementCounter(key: string, windowSeconds: number): Promise<number> {
  const redis = await rateLimitClient()
  const count = await redis.eval(INCREMENT_WITH_EXPIRY, 1, key, windowSeconds)
  return Number(count)
}

type RateLimitStatus = {
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

function assertRateLimitWindow(input: Pick<RateLimitInput, 'key' | 'windowSeconds'>): void {
  if (
    typeof input.key !== 'string' ||
    input.key.length === 0 ||
    input.key.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(input.key)
  ) {
    throw new Error('Rate-limit key is invalid or exceeds 512 characters.')
  }
  if (
    !Number.isSafeInteger(input.windowSeconds) ||
    input.windowSeconds < 1 ||
    input.windowSeconds > 365 * 24 * 3600
  ) {
    throw new Error('Rate-limit windowSeconds must be a positive bounded integer.')
  }
}

function assertRateLimitInput(input: RateLimitInput): void {
  assertRateLimitWindow(input)
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 10_000_000) {
    throw new Error('Rate-limit limit must be a positive bounded integer.')
  }
}

/** Atomically consume one request from a fixed window. Unlike the failure
 * counter, the Nth request is allowed and N+1 is rejected. */
export async function consumeRateLimit(input: RateLimitInput): Promise<RateLimitStatus> {
  assertRateLimitInput(input)
  const nowMs = Date.now()
  const count = await incrementCounter(
    redisKey(input.key, input.windowSeconds, nowMs),
    input.windowSeconds,
  )
  const currentBucket = windowBucket(input.windowSeconds, nowMs)
  return {
    allowed: count <= input.limit,
    count,
    remaining: Math.max(0, input.limit - count),
    resetAt: new Date((currentBucket + 1) * input.windowSeconds * 1_000),
  }
}

export async function getRateLimitStatus(input: RateLimitInput): Promise<RateLimitStatus> {
  assertRateLimitInput(input)
  const nowMs = Date.now()
  const raw = await (await rateLimitClient()).get(redisKey(input.key, input.windowSeconds, nowMs))
  const count = raw ? Number(raw) : 0
  const currentBucket = windowBucket(input.windowSeconds, nowMs)
  return {
    allowed: count < input.limit,
    count,
    remaining: Math.max(0, input.limit - count),
    resetAt: new Date((currentBucket + 1) * input.windowSeconds * 1_000),
  }
}

export async function recordRateLimitFailure(input: RateLimitInput): Promise<RateLimitStatus> {
  assertRateLimitInput(input)
  const nowMs = Date.now()
  const count = await incrementCounter(
    redisKey(input.key, input.windowSeconds, nowMs),
    input.windowSeconds,
  )
  const currentBucket = windowBucket(input.windowSeconds, nowMs)
  return {
    allowed: count < input.limit,
    count,
    remaining: Math.max(0, input.limit - count),
    resetAt: new Date((currentBucket + 1) * input.windowSeconds * 1_000),
  }
}

export async function resetRateLimit(input: Pick<RateLimitInput, 'key' | 'windowSeconds'>) {
  assertRateLimitWindow(input)
  await (await rateLimitClient()).del(redisKey(input.key, input.windowSeconds))
}
