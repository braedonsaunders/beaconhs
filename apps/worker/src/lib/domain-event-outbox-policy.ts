const INITIAL_RETRY_MS = 15_000
const MAX_RETRY_MS = 60 * 60_000

/** Retry forever: a transient outage must never turn a committed event into lost work. */
export function domainEventRetryAt(attempts: number, now: Date): Date {
  const safeAttempts = Number.isFinite(attempts) ? Math.trunc(attempts) : 1
  const exponent = Math.max(0, Math.min(30, safeAttempts - 1))
  const delayMs = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** exponent)
  return new Date(now.getTime() + delayMs)
}
