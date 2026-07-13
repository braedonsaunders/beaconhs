'use server'

import { randomBytes, randomUUID } from 'node:crypto'
import { and, count, eq, gt, isNull, lte } from 'drizzle-orm'
import { z } from 'zod'
import { attachments, attachmentUploadReservations } from '@beaconhs/db/schema'
import {
  deleteObject,
  ensureBucket,
  getObjectRange,
  headObject,
  newAttachmentKey,
  newPendingUploadKey,
  presignPut,
  promoteObject,
} from '@beaconhs/storage'
import { attachmentUrl } from './attachment-url'
import { requireRequestContext } from './auth'
import {
  hashUploadToken,
  normalizedContentType,
  validateReservedUpload,
} from './upload-verification'
import {
  uploadContentDisposition,
  uploadContentTypeError,
  uploadedFileHeaderError,
} from './upload-policy'

const MAX_UPLOAD_BYTES = {
  image: 50 * 1024 * 1024,
  signature: 10 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  document: 500 * 1024 * 1024,
  video: 500 * 1024 * 1024,
  other: 500 * 1024 * 1024,
} as const

const MAX_PENDING_UPLOADS_PER_USER = 25
const RESERVATION_TTL_MS = 10 * 60 * 1000

const kindSchema = z.enum(['image', 'document', 'video', 'audio', 'signature', 'other'])

const requestSchema = z
  .object({
    kind: kindSchema,
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((value) => !/[\0-\x1f\x7f]/.test(value), {
        message: 'Filename contains invalid characters',
      }),
    contentType: z.string().trim().min(1).max(120),
    sizeBytes: z.number().int().positive(),
  })
  .refine((value) => value.sizeBytes <= MAX_UPLOAD_BYTES[value.kind], {
    message: 'File is too large for this upload type',
  })
  .refine((value) => uploadContentTypeError(value.kind, value.contentType) === null, {
    message: 'File type is not allowed for this upload',
  })

const finalizeSchema = z.object({ uploadId: z.string().uuid() })

let storageReady: Promise<void> | null = null

function ensureStorageReady(): Promise<void> {
  storageReady ??= ensureBucket().catch((error) => {
    storageReady = null
    throw error
  })
  return storageReady
}

async function discardExpiredUploads(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
): Promise<void> {
  const expired = await ctx.db((tx) =>
    tx
      .select({ id: attachmentUploadReservations.id, key: attachmentUploadReservations.stagingKey })
      .from(attachmentUploadReservations)
      .where(
        and(
          eq(attachmentUploadReservations.requestedBy, ctx.userId),
          isNull(attachmentUploadReservations.consumedAt),
          lte(attachmentUploadReservations.expiresAt, new Date()),
        ),
      )
      .limit(10),
  )

  for (const row of expired) {
    try {
      await deleteObject({ key: row.key })
      await ctx.db((tx) =>
        tx.delete(attachmentUploadReservations).where(eq(attachmentUploadReservations.id, row.id)),
      )
    } catch (error) {
      console.warn('[uploads] expired staging object cleanup failed', { uploadId: row.id, error })
    }
  }
}

export async function requestUpload(
  input: z.infer<typeof requestSchema>,
): Promise<{ ok: true; uploadId: string; putUrl: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid upload' }

  try {
    await ensureStorageReady()
    await discardExpiredUploads(ctx)

    const [pending] = await ctx.db((tx) =>
      tx
        .select({ value: count() })
        .from(attachmentUploadReservations)
        .where(
          and(
            eq(attachmentUploadReservations.requestedBy, ctx.userId),
            isNull(attachmentUploadReservations.consumedAt),
            gt(attachmentUploadReservations.expiresAt, new Date()),
          ),
        ),
    )
    if ((pending?.value ?? 0) >= MAX_PENDING_UPLOADS_PER_USER) {
      return { ok: false, error: 'Too many uploads are already pending. Try again shortly.' }
    }

    const uploadId = randomUUID()
    const uploadToken = randomBytes(32).toString('base64url')
    const stagingKey = newPendingUploadKey({ tenantId: ctx.tenantId, uploadId })
    const r2Key = newAttachmentKey({
      tenantId: ctx.tenantId,
      kind: parsed.data.kind,
      filename: parsed.data.filename,
    })
    const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS)

    await ctx.db((tx) =>
      tx.insert(attachmentUploadReservations).values({
        id: uploadId,
        tenantId: ctx.tenantId,
        requestedBy: ctx.userId,
        kind: parsed.data.kind,
        stagingKey,
        r2Key,
        filename: parsed.data.filename,
        contentType: parsed.data.contentType,
        sizeBytes: parsed.data.sizeBytes,
        verificationTokenHash: hashUploadToken(uploadToken),
        expiresAt,
      }),
    )

    try {
      const putUrl = await presignPut({
        key: stagingKey,
        contentType: parsed.data.contentType,
        uploadToken,
        expiresInSeconds: 300,
      })
      return { ok: true, uploadId, putUrl }
    } catch (error) {
      await ctx.db((tx) =>
        tx
          .delete(attachmentUploadReservations)
          .where(eq(attachmentUploadReservations.id, uploadId)),
      )
      throw error
    }
  } catch (error) {
    console.error('[uploads] upload request failed', error)
    return { ok: false, error: 'Upload could not be started' }
  }
}

export async function finalizeUpload(
  input: z.infer<typeof finalizeSchema>,
): Promise<{ ok: true; attachmentId: string; url: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const parsed = finalizeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid upload reservation' }

  try {
    await ensureStorageReady()
    const reservation = await ctx.db(async (tx) => {
      const [row] = await tx
        .select()
        .from(attachmentUploadReservations)
        .where(eq(attachmentUploadReservations.id, parsed.data.uploadId))
        .limit(1)
      return row ?? null
    })

    if (!reservation || reservation.requestedBy !== ctx.userId) {
      return { ok: false, error: 'Upload reservation not found' }
    }
    if (reservation.attachmentId) {
      return {
        ok: true,
        attachmentId: reservation.attachmentId,
        url: attachmentUrl(reservation.attachmentId),
      }
    }
    if (reservation.expiresAt.getTime() <= Date.now()) {
      return { ok: false, error: 'Upload reservation expired' }
    }

    const staged = await headObject({ key: reservation.stagingKey })
    if (!staged) return { ok: false, error: 'Uploaded object was not found' }
    const stagedError = validateReservedUpload(staged, {
      tokenHash: reservation.verificationTokenHash,
      sizeBytes: reservation.sizeBytes,
      contentType: reservation.contentType,
    })
    if (stagedError) return { ok: false, error: stagedError }
    const header = await getObjectRange({
      key: reservation.stagingKey,
      start: 0,
      end: Math.min(reservation.sizeBytes - 1, 511),
    })
    const headerError = uploadedFileHeaderError(reservation.kind, reservation.contentType, header)
    if (headerError) return { ok: false, error: headerError }

    const contentDisposition = uploadContentDisposition(reservation.kind, reservation.contentType)
    const existingFinal = await headObject({ key: reservation.r2Key })
    if (!existingFinal) {
      await promoteObject({
        sourceKey: reservation.stagingKey,
        destinationKey: reservation.r2Key,
        contentType: reservation.contentType,
        contentDisposition,
      })
    }
    const finalObject = existingFinal ?? (await headObject({ key: reservation.r2Key }))
    if (
      !finalObject ||
      finalObject.contentLength !== reservation.sizeBytes ||
      normalizedContentType(finalObject.contentType) !==
        normalizedContentType(reservation.contentType) ||
      finalObject.contentDisposition !== contentDisposition
    ) {
      return { ok: false, error: 'Finalized object could not be verified' }
    }

    const attachmentId = await ctx.db(async (tx) => {
      const [locked] = await tx
        .select()
        .from(attachmentUploadReservations)
        .where(eq(attachmentUploadReservations.id, reservation.id))
        .for('update')
        .limit(1)
      if (!locked || locked.requestedBy !== ctx.userId) throw new Error('reservation disappeared')
      if (locked.attachmentId) return locked.attachmentId
      if (locked.expiresAt.getTime() <= Date.now()) throw new Error('reservation expired')

      const [created] = await tx
        .insert(attachments)
        .values({
          tenantId: ctx.tenantId,
          uploadedBy: ctx.userId,
          kind: locked.kind,
          r2Key: locked.r2Key,
          contentType: locked.contentType,
          sizeBytes: locked.sizeBytes,
          filename: locked.filename,
        })
        .returning({ id: attachments.id })
      if (!created) throw new Error('attachment insert failed')

      await tx
        .update(attachmentUploadReservations)
        .set({ attachmentId: created.id, consumedAt: new Date() })
        .where(eq(attachmentUploadReservations.id, locked.id))
      return created.id
    })

    try {
      await deleteObject({ key: reservation.stagingKey })
    } catch (error) {
      console.warn('[uploads] finalized staging object cleanup failed', {
        uploadId: reservation.id,
        error,
      })
    }

    return { ok: true, attachmentId, url: attachmentUrl(attachmentId) }
  } catch (error) {
    console.error('[uploads] upload finalization failed', {
      uploadId: parsed.data.uploadId,
      error,
    })
    return { ok: false, error: 'Upload could not be finalized' }
  }
}
