import { and, asc, eq, lte, or, sql } from 'drizzle-orm'
import type { Database } from './client'
import { storageObjectDeletionOutbox } from './schema'

const INITIAL_RETRY_MS = 15_000
const MAX_RETRY_MS = 60 * 60_000
export const STORAGE_OBJECT_DELETION_CLAIM_TIMEOUT_MS = 5 * 60_000

export type ClaimedStorageObjectDeletion = {
  id: string
  tenantId: string
  attachmentId: string
  objectKey: string
  attempts: number
  leaseId: string
  claimedAt: Date
}

/** Retry forever: a storage outage must never turn committed deletion into lost work. */
export function storageObjectDeletionRetryAt(attempts: number, now: Date): Date {
  const safeAttempts = Number.isFinite(attempts) ? Math.trunc(attempts) : 1
  const exponent = Math.max(0, Math.min(30, safeAttempts - 1))
  const delayMs = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** exponent)
  return new Date(now.getTime() + delayMs)
}

export function storageObjectDeletionError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .slice(0, 4_000)
}

/** Claim a bounded, cross-tenant batch, including leases abandoned by a dead worker. */
export async function claimStorageObjectDeletionBatch(
  tx: Database,
  input: { now: Date; limit: number },
): Promise<ClaimedStorageObjectDeletion[]> {
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    throw new Error('Storage deletion claim time must be a valid date')
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new Error('Storage deletion claim limit must be an integer from 1 to 500')
  }
  const staleBefore = new Date(input.now.getTime() - STORAGE_OBJECT_DELETION_CLAIM_TIMEOUT_MS)
  const rows = await tx
    .select({
      id: storageObjectDeletionOutbox.id,
      tenantId: storageObjectDeletionOutbox.tenantId,
      attachmentId: storageObjectDeletionOutbox.attachmentId,
      objectKey: storageObjectDeletionOutbox.objectKey,
      attempts: storageObjectDeletionOutbox.attempts,
    })
    .from(storageObjectDeletionOutbox)
    .where(
      or(
        and(
          eq(storageObjectDeletionOutbox.status, 'pending'),
          lte(storageObjectDeletionOutbox.availableAt, input.now),
        ),
        and(
          eq(storageObjectDeletionOutbox.status, 'deleting'),
          lte(storageObjectDeletionOutbox.claimedAt, staleBefore),
        ),
      ),
    )
    .orderBy(asc(storageObjectDeletionOutbox.createdAt), asc(storageObjectDeletionOutbox.id))
    .limit(input.limit)
    .for('update', { skipLocked: true })

  const claimed: ClaimedStorageObjectDeletion[] = []
  for (const row of rows) {
    const [intent] = await tx
      .update(storageObjectDeletionOutbox)
      .set({
        status: 'deleting',
        leaseId: sql`gen_random_uuid()`,
        claimedAt: input.now,
        attempts: sql`${storageObjectDeletionOutbox.attempts} + 1`,
        lastError: null,
      })
      .where(
        and(
          eq(storageObjectDeletionOutbox.id, row.id),
          eq(storageObjectDeletionOutbox.tenantId, row.tenantId),
        ),
      )
      .returning({
        id: storageObjectDeletionOutbox.id,
        tenantId: storageObjectDeletionOutbox.tenantId,
        attachmentId: storageObjectDeletionOutbox.attachmentId,
        objectKey: storageObjectDeletionOutbox.objectKey,
        attempts: storageObjectDeletionOutbox.attempts,
        leaseId: storageObjectDeletionOutbox.leaseId,
        claimedAt: storageObjectDeletionOutbox.claimedAt,
      })
    if (!intent?.leaseId || !intent.claimedAt) {
      throw new Error(`Storage deletion ${row.id} was locked but could not be leased`)
    }
    claimed.push({ ...intent, leaseId: intent.leaseId, claimedAt: intent.claimedAt })
  }
  return claimed
}

export async function completeStorageObjectDeletion(
  tx: Database,
  input: { id: string; leaseId: string },
): Promise<boolean> {
  const [completed] = await tx
    .delete(storageObjectDeletionOutbox)
    .where(
      and(
        eq(storageObjectDeletionOutbox.id, input.id),
        eq(storageObjectDeletionOutbox.status, 'deleting'),
        eq(storageObjectDeletionOutbox.leaseId, input.leaseId),
      ),
    )
    .returning({ id: storageObjectDeletionOutbox.id })
  return Boolean(completed)
}

export async function retryStorageObjectDeletion(
  tx: Database,
  input: {
    id: string
    leaseId: string
    attempts: number
    failedAt: Date
    error: unknown
  },
): Promise<boolean> {
  const [released] = await tx
    .update(storageObjectDeletionOutbox)
    .set({
      status: 'pending',
      availableAt: storageObjectDeletionRetryAt(input.attempts, input.failedAt),
      leaseId: null,
      claimedAt: null,
      lastError: storageObjectDeletionError(input.error),
    })
    .where(
      and(
        eq(storageObjectDeletionOutbox.id, input.id),
        eq(storageObjectDeletionOutbox.status, 'deleting'),
        eq(storageObjectDeletionOutbox.leaseId, input.leaseId),
      ),
    )
    .returning({ id: storageObjectDeletionOutbox.id })
  return Boolean(released)
}
