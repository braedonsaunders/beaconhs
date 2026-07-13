import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'

const MAX_CLOCK_SKEW_MS = 5 * 60_000

function signingKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('BETTER_AUTH_SECRET is required for internal domain-event dispatch')
  }
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(secret ?? 'beaconhs-dev-insecure-secret'),
      Buffer.from('beaconhs-domain-events'),
      Buffer.from('worker-to-web-v1'),
      32,
    ),
  )
}

export function signDomainEventRequest(eventId: string, timestamp: string): string {
  return createHmac('sha256', signingKey()).update(`${timestamp}.${eventId}`).digest('base64url')
}

export function verifyDomainEventRequest(
  eventId: string,
  timestamp: string | null,
  signature: string | null,
  now: Date = new Date(),
): boolean {
  const sentAt = timestamp ? Number(timestamp) : Number.NaN
  if (!Number.isFinite(sentAt) || Math.abs(now.getTime() - sentAt) > MAX_CLOCK_SKEW_MS) return false
  if (!signature) return false
  const expected = Buffer.from(signDomainEventRequest(eventId, timestamp!), 'utf8')
  const actual = Buffer.from(signature, 'utf8')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
