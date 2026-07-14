import { and, eq, isNotNull, isNull, lte, or } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

const INITIAL_RETRY_MS = 15_000
const MAX_RETRY_MS = 60 * 60_000

/** Keep one scheduler tick bounded even when a deployment inherits a large backlog. */
export const DURABLE_PUBLICATION_BATCH_SIZE = 100

/**
 * Publication is a short queue/database operation, but a full sequential batch
 * can be delayed by an unhealthy Redis connection. Do not let another replica
 * steal a live batch before that bounded attempt has had time to finish.
 */
const DURABLE_PUBLICATION_CLAIM_TIMEOUT_MS = 15 * 60_000

/** Re-assert queued report jobs so a Redis data loss cannot orphan the DB ledger. */
const DURABLE_PUBLICATION_REPUBLISH_MS = 15 * 60_000

function validDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`${label} must be a valid date`)
  }
  return value
}

export function durablePublicationStaleBefore(now: Date): Date {
  return new Date(
    validDate(now, 'Durable publication claim time').getTime() -
      DURABLE_PUBLICATION_CLAIM_TIMEOUT_MS,
  )
}

/** One canonical eligibility rule for every durable publisher ledger. */
export function durablePublicationClaimPredicate(
  columns: {
    status: AnyPgColumn
    availableAt: AnyPgColumn
    leaseId: AnyPgColumn
    claimedAt: AnyPgColumn
  },
  now: Date,
) {
  const staleBefore = durablePublicationStaleBefore(now)
  return and(
    eq(columns.status, 'queued'),
    or(
      and(isNull(columns.leaseId), isNull(columns.claimedAt), lte(columns.availableAt, now)),
      and(isNotNull(columns.leaseId), lte(columns.claimedAt, staleBefore)),
    ),
  )
}

/** Retry forever with bounded exponential backoff; committed work is never discarded. */
export function durablePublicationRetryAt(attempts: number, failedAt: Date): Date {
  const safeAttempts = Number.isFinite(attempts) ? Math.trunc(attempts) : 1
  const exponent = Math.max(0, Math.min(30, safeAttempts - 1))
  const delayMs = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** exponent)
  return new Date(validDate(failedAt, 'Durable publication failure time').getTime() + delayMs)
}

export function durablePublicationRepublishAt(publishedAt: Date): Date {
  return new Date(
    validDate(publishedAt, 'Durable publication completion time').getTime() +
      DURABLE_PUBLICATION_REPUBLISH_MS,
  )
}

export function durablePublicationError(error: unknown, fallback: string): string {
  const sanitized = (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 4_000)
  return sanitized || fallback
}
