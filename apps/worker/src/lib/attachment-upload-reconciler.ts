import { and, asc, eq, isNull, lte, notInArray, or } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { attachments, attachmentUploadReservations } from '@beaconhs/db/schema'
import { assertTenantObjectKey, deleteObject as deleteStoredObject } from '@beaconhs/storage'
import { durablePublicationError } from './durable-publication-policy'

const RECONCILIATION_BATCH_SIZE = 50

type ReservationSnapshot = typeof attachmentUploadReservations.$inferSelect

type LiveAttachmentSnapshot = Pick<
  typeof attachments.$inferSelect,
  'id' | 'tenantId' | 'kind' | 'r2Key' | 'contentType' | 'sizeBytes' | 'filename'
>

type ExpiredUploadReconciliationDecision =
  { kind: 'recover'; attachmentId: string } | { kind: 'discard' }

function normalizedContentType(value: string): string {
  return value.split(';', 1)[0]!.trim().toLowerCase()
}

/**
 * Fail closed if an object key is already represented by attachment metadata
 * that does not exactly match the reservation. Such a row needs operator
 * repair; it must never cause the worker to link across tenants or delete a
 * potentially live final object.
 */
export function expiredUploadReconciliationDecision(
  reservation: Pick<
    ReservationSnapshot,
    'tenantId' | 'attachmentId' | 'kind' | 'r2Key' | 'contentType' | 'sizeBytes' | 'filename'
  >,
  liveAttachment: LiveAttachmentSnapshot | null,
): ExpiredUploadReconciliationDecision {
  if (!liveAttachment) return { kind: 'discard' }
  if (
    liveAttachment.tenantId !== reservation.tenantId ||
    liveAttachment.r2Key !== reservation.r2Key
  ) {
    throw new Error('Live attachment does not belong to the upload reservation tenant and key')
  }
  if (reservation.attachmentId && reservation.attachmentId !== liveAttachment.id) {
    throw new Error('Upload reservation points to a different live attachment')
  }
  if (
    liveAttachment.kind !== reservation.kind ||
    liveAttachment.sizeBytes !== reservation.sizeBytes ||
    normalizedContentType(liveAttachment.contentType) !==
      normalizedContentType(reservation.contentType) ||
    liveAttachment.filename !== reservation.filename
  ) {
    throw new Error('Live attachment metadata does not match the upload reservation')
  }
  return { kind: 'recover', attachmentId: liveAttachment.id }
}

/** Apply object-store effects before the matching database mutation. */
export async function applyExpiredUploadReconciliation(
  reservation: Pick<ReservationSnapshot, 'stagingKey' | 'r2Key'>,
  decision: ExpiredUploadReconciliationDecision,
  operations: {
    deleteObject: (key: string) => Promise<void>
    recover: (attachmentId: string) => Promise<void>
    discard: () => Promise<void>
  },
): Promise<'recover' | 'discard'> {
  await operations.deleteObject(reservation.stagingKey)
  if (decision.kind === 'recover') {
    await operations.recover(decision.attachmentId)
    return 'recover'
  }
  await operations.deleteObject(reservation.r2Key)
  await operations.discard()
  return 'discard'
}

type ExpiredUploadReconciliationResult = {
  examined: number
  recovered: number
  discarded: number
  errors: number
}

/**
 * Reconcile a bounded, cross-tenant batch of expired upload reservations.
 *
 * Each candidate is locked in its own transaction so an object-store failure
 * cannot roll back successful work for other rows. `SKIP LOCKED` lets scheduler
 * replicas drain disjoint rows; the per-tick exclusion list prevents one
 * persistently failing row from monopolizing this worker's bounded window.
 */
export async function reconcileExpiredAttachmentUploads(
  now: Date = new Date(),
): Promise<ExpiredUploadReconciliationResult> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Expired upload reconciliation time must be a valid date')
  }

  const result: ExpiredUploadReconciliationResult = {
    examined: 0,
    recovered: 0,
    discarded: 0,
    errors: 0,
  }
  const attemptedIds: string[] = []

  while (attemptedIds.length < RECONCILIATION_BATCH_SIZE) {
    let attemptedId: string | null = null
    try {
      const outcome = await withSuperAdmin(db, async (tx) => {
        const [reservation] = await tx
          .select()
          .from(attachmentUploadReservations)
          .where(
            and(
              lte(attachmentUploadReservations.expiresAt, now),
              or(
                isNull(attachmentUploadReservations.consumedAt),
                isNull(attachmentUploadReservations.attachmentId),
              ),
              attemptedIds.length > 0
                ? notInArray(attachmentUploadReservations.id, attemptedIds)
                : undefined,
            ),
          )
          .orderBy(
            asc(attachmentUploadReservations.expiresAt),
            asc(attachmentUploadReservations.id),
          )
          .limit(1)
          .for('update', { skipLocked: true })
        if (!reservation) return null
        attemptedId = reservation.id

        assertTenantObjectKey({ tenantId: reservation.tenantId, key: reservation.stagingKey })
        assertTenantObjectKey({ tenantId: reservation.tenantId, key: reservation.r2Key })

        const [liveAttachment] = await tx
          .select({
            id: attachments.id,
            tenantId: attachments.tenantId,
            kind: attachments.kind,
            r2Key: attachments.r2Key,
            contentType: attachments.contentType,
            sizeBytes: attachments.sizeBytes,
            filename: attachments.filename,
          })
          .from(attachments)
          .where(eq(attachments.r2Key, reservation.r2Key))
          .limit(1)
        const decision = expiredUploadReconciliationDecision(reservation, liveAttachment ?? null)

        const kind = await applyExpiredUploadReconciliation(reservation, decision, {
          deleteObject: (key) => deleteStoredObject({ key }),
          recover: async (attachmentId) => {
            // The final object is live. Recover the missing reservation link
            // so future scans exclude this row; never delete the final key.
            const [recovered] = await tx
              .update(attachmentUploadReservations)
              .set({
                attachmentId,
                consumedAt: reservation.consumedAt ?? now,
              })
              .where(
                and(
                  eq(attachmentUploadReservations.id, reservation.id),
                  eq(attachmentUploadReservations.tenantId, reservation.tenantId),
                ),
              )
              .returning({ id: attachmentUploadReservations.id })
            if (!recovered) throw new Error('Expired upload reservation could not be recovered')
          },
          discard: async () => {
            // No attachment row owns the final key. Consume the database row
            // only after both idempotent object deletes have succeeded.
            const [discarded] = await tx
              .delete(attachmentUploadReservations)
              .where(
                and(
                  eq(attachmentUploadReservations.id, reservation.id),
                  eq(attachmentUploadReservations.tenantId, reservation.tenantId),
                ),
              )
              .returning({ id: attachmentUploadReservations.id })
            if (!discarded) throw new Error('Expired upload reservation could not be discarded')
          },
        })
        return { id: reservation.id, kind }
      })

      if (!outcome) break
      attemptedIds.push(outcome.id)
      result.examined += 1
      if (outcome.kind === 'recover') result.recovered += 1
      else result.discarded += 1
    } catch (error) {
      result.examined += 1
      result.errors += 1
      if (attemptedId && !attemptedIds.includes(attemptedId)) attemptedIds.push(attemptedId)
      console.warn('[uploads] expired reservation reconciliation failed', {
        uploadId: attemptedId,
        error: durablePublicationError(error, 'Expired upload reconciliation failed'),
      })
      // A failure before a row was selected is infrastructure-wide; retrying
      // the same query in this tick cannot make useful progress.
      if (!attemptedId) break
    }
  }

  return result
}
