import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import {
  getRateLimitStatus,
  recordRateLimitFailure,
  resetRateLimit,
  type RateLimitInput,
} from '@beaconhs/jobs/rate-limit'

const PIN_WINDOW_SECONDS = 10 * 60
const CLIENT_LIMIT = 8
const TENANT_LIMIT = 30

export type PublicPinRateLimitHandle = {
  checks: RateLimitInput[]
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function headerFirst(value: string | null) {
  return value?.split(',')[0]?.trim() || ''
}

async function clientFingerprint() {
  const h = await headers()
  const ip =
    headerFirst(h.get('x-forwarded-for')) ||
    h.get('x-real-ip') ||
    h.get('cf-connecting-ip') ||
    'unknown'
  const ua = h.get('user-agent')?.slice(0, 160) || 'unknown'
  return digest(`${ip}:${ua}`)
}

function formatReset(resetAt: Date) {
  const seconds = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1_000))
  if (seconds < 60) return `${seconds} seconds`
  return `${Math.ceil(seconds / 60)} minutes`
}

function checksFor(scope: string, tenantId: string, fingerprint: string): RateLimitInput[] {
  return [
    {
      key: `public-pin:${scope}:tenant:${tenantId}`,
      limit: TENANT_LIMIT,
      windowSeconds: PIN_WINDOW_SECONDS,
    },
    {
      key: `public-pin:${scope}:client:${tenantId}:${fingerprint}`,
      limit: CLIENT_LIMIT,
      windowSeconds: PIN_WINDOW_SECONDS,
    },
  ]
}

export async function guardPublicPinRateLimit(
  scope: 'people-kiosk' | 'equipment-kiosk',
  tenantId: string,
): Promise<{ ok: true; handle: PublicPinRateLimitHandle } | { ok: false; error: string }> {
  try {
    const checks = checksFor(scope, tenantId, await clientFingerprint())
    const statuses = await Promise.all(checks.map((check) => getRateLimitStatus(check)))
    const blocked = statuses.find((status) => !status.allowed)
    if (blocked) {
      return {
        ok: false,
        error: `Too many PIN attempts. Try again in ${formatReset(blocked.resetAt)}.`,
      }
    }
    return { ok: true, handle: { checks } }
  } catch (error) {
    console.error('Public PIN rate limit unavailable', error)
    return { ok: false, error: 'Kiosk temporarily unavailable. Try again in a minute.' }
  }
}

export async function recordPublicPinFailure(
  handle: PublicPinRateLimitHandle,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await Promise.all(handle.checks.map((check) => recordRateLimitFailure(check)))
    return { ok: true }
  } catch (error) {
    console.error('Public PIN rate limit failure recording unavailable', error)
    return { ok: false, error: 'Kiosk temporarily unavailable. Try again in a minute.' }
  }
}

export async function resetPublicPinRateLimit(handle: PublicPinRateLimitHandle) {
  try {
    await Promise.all(
      handle.checks.map((check) =>
        resetRateLimit({ key: check.key, windowSeconds: check.windowSeconds }),
      ),
    )
  } catch (error) {
    console.error('Public PIN rate limit reset unavailable', error)
  }
}
