import {
  claimStorageObjectDeletionBatch,
  completeStorageObjectDeletion,
  db,
  retryStorageObjectDeletion,
  withSuperAdmin,
} from '@beaconhs/db'
import { assertTenantObjectKey, deleteObject } from '@beaconhs/storage'

const BATCH_SIZE = 50
const DELETE_CONCURRENCY = 10

type StorageObjectDeletionScanResult = {
  claimed: number
  deleted: number
  retried: number
}

/** Drain a bounded cross-tenant deletion batch. Object DELETE is idempotent. */
export async function drainStorageObjectDeletionOutbox(
  now: Date = new Date(),
): Promise<StorageObjectDeletionScanResult> {
  const result: StorageObjectDeletionScanResult = { claimed: 0, deleted: 0, retried: 0 }
  const claimed = await withSuperAdmin(db, (tx) =>
    claimStorageObjectDeletionBatch(tx, { now, limit: BATCH_SIZE }),
  )
  result.claimed = claimed.length

  for (let offset = 0; offset < claimed.length; offset += DELETE_CONCURRENCY) {
    await Promise.all(
      claimed.slice(offset, offset + DELETE_CONCURRENCY).map(async (intent) => {
        try {
          assertTenantObjectKey({ tenantId: intent.tenantId, key: intent.objectKey })
          await deleteObject({ key: intent.objectKey })
          const completed = await withSuperAdmin(db, (tx) =>
            completeStorageObjectDeletion(tx, {
              id: intent.id,
              leaseId: intent.leaseId,
            }),
          )
          if (completed) result.deleted += 1
        } catch (error) {
          const released = await withSuperAdmin(db, (tx) =>
            retryStorageObjectDeletion(tx, {
              id: intent.id,
              leaseId: intent.leaseId,
              attempts: intent.attempts,
              failedAt: new Date(),
              error,
            }),
          )
          if (released) result.retried += 1
        }
      }),
    )
  }
  return result
}
