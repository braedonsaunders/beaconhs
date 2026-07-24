'use server'

import { randomBytes, randomUUID } from 'node:crypto'
import { and, count, eq, gt, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { attachments, attachmentUploadReservations } from '@beaconhs/db/schema'
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  deleteObject,
  ensureBucket,
  getObject,
  getObjectRange,
  headObject,
  MULTIPART_UPLOAD_PART_SIZE_BYTES,
  multipartPartCount,
  newAttachmentKey,
  newPendingUploadKey,
  presignMultipartPart,
  presignPut,
  promoteObject,
  putObject,
  shouldUseMultipartUpload,
} from '@beaconhs/storage'
import { MAX_PPTX_FILE_BYTES } from '@beaconhs/office/limits'
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
import { optimizeUploadedImage } from './image-upload-optimization'

const MAX_UPLOAD_BYTES = {
  image: 50 * 1024 * 1024,
  signature: 10 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  document: MAX_PPTX_FILE_BYTES,
  video: 500 * 1024 * 1024,
  other: 500 * 1024 * 1024,
} as const

const MAX_PENDING_UPLOADS_PER_USER = 25
const STANDARD_RESERVATION_TTL_MS = 10 * 60 * 1000
const MULTIPART_RESERVATION_TTL_MS = 60 * 60 * 1000

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

const finalizeSchema = z.object({
  uploadId: z.string().uuid(),
  multipartUploadId: z.string().min(1).max(1024).optional(),
})

let storageReady: Promise<void> | null = null

function ensureStorageReady(): Promise<void> {
  storageReady ??= ensureBucket().catch((error) => {
    storageReady = null
    throw error
  })
  return storageReady
}

async function compensateUncommittedFinal(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  uploadId: string,
): Promise<void> {
  await ctx.db(async (tx) => {
    const [reservation] = await tx
      .select()
      .from(attachmentUploadReservations)
      .where(eq(attachmentUploadReservations.id, uploadId))
      .for('update')
      .limit(1)
    if (
      !reservation ||
      reservation.requestedBy !== ctx.userId ||
      reservation.attachmentId ||
      reservation.consumedAt
    ) {
      return
    }

    const [liveAttachment] = await tx
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.r2Key, reservation.r2Key))
      .limit(1)
    if (liveAttachment) {
      await tx
        .update(attachmentUploadReservations)
        .set({ attachmentId: liveAttachment.id, consumedAt: new Date() })
        .where(eq(attachmentUploadReservations.id, reservation.id))
      return
    }

    // Reacquiring the reservation lock after a failed commit prevents a
    // waiting finalizer from linking this key while compensation removes it.
    await deleteObject({ key: reservation.r2Key })
  })
}

export async function requestUpload(input: z.infer<typeof requestSchema>): Promise<
  | { ok: true; uploadId: string; mode: 'single'; putUrl: string }
  | {
      ok: true
      uploadId: string
      mode: 'multipart'
      multipartUploadId: string
      partSizeBytes: number
      partUrls: string[]
    }
  | { ok: false; error: string }
> {
  const ctx = await requireRequestContext()
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid upload' }

  try {
    await ensureStorageReady()

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
    const useMultipart = shouldUseMultipartUpload(parsed.data.sizeBytes)
    const expiresAt = new Date(
      Date.now() + (useMultipart ? MULTIPART_RESERVATION_TTL_MS : STANDARD_RESERVATION_TTL_MS),
    )

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

    let multipartUploadId: string | null = null
    try {
      if (useMultipart) {
        multipartUploadId = await createMultipartUpload({
          key: stagingKey,
          contentType: parsed.data.contentType,
          uploadToken,
        })
        const partCount = multipartPartCount(parsed.data.sizeBytes)
        const partUrls: string[] = []
        for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
          partUrls.push(
            await presignMultipartPart({
              key: stagingKey,
              uploadId: multipartUploadId,
              partNumber,
              expiresInSeconds: 3600,
            }),
          )
        }
        return {
          ok: true,
          uploadId,
          mode: 'multipart',
          multipartUploadId,
          partSizeBytes: MULTIPART_UPLOAD_PART_SIZE_BYTES,
          partUrls,
        }
      }
      const putUrl = await presignPut({
        key: stagingKey,
        contentType: parsed.data.contentType,
        uploadToken,
        expiresInSeconds: 300,
      })
      return { ok: true, uploadId, mode: 'single', putUrl }
    } catch (error) {
      if (multipartUploadId) {
        await abortMultipartUpload({ key: stagingKey, uploadId: multipartUploadId }).catch(
          () => undefined,
        )
      }
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

export async function finalizeUpload(input: z.infer<typeof finalizeSchema>): Promise<
  | {
      ok: true
      attachmentId: string
      url: string
      filename: string
      contentType: string
      sizeBytes: number
      width?: number
      height?: number
    }
  | { ok: false; error: string }
> {
  const ctx = await requireRequestContext()
  const parsed = finalizeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Invalid upload reservation' }

  try {
    await ensureStorageReady()
    if (parsed.data.multipartUploadId) {
      const [reservation] = await ctx.db((tx) =>
        tx
          .select({
            attachmentId: attachmentUploadReservations.attachmentId,
            requestedBy: attachmentUploadReservations.requestedBy,
            stagingKey: attachmentUploadReservations.stagingKey,
          })
          .from(attachmentUploadReservations)
          .where(eq(attachmentUploadReservations.id, parsed.data.uploadId))
          .limit(1),
      )
      if (!reservation || reservation.requestedBy !== ctx.userId) {
        return { ok: false, error: 'Upload reservation not found' }
      }
      if (!reservation.attachmentId) {
        try {
          await completeMultipartUpload({
            key: reservation.stagingKey,
            uploadId: parsed.data.multipartUploadId,
          })
        } catch (error) {
          const completedObject = await headObject({ key: reservation.stagingKey })
          if (!completedObject) throw error
        }
      }
    }
    const outcome = await ctx.db(async (tx) => {
      const [reservation] = await tx
        .select()
        .from(attachmentUploadReservations)
        .where(eq(attachmentUploadReservations.id, parsed.data.uploadId))
        .for('update')
        .limit(1)
      if (!reservation || reservation.requestedBy !== ctx.userId) {
        return { ok: false as const, error: 'Upload reservation not found' }
      }
      if (reservation.attachmentId) {
        const [attachment] = await tx
          .select({
            id: attachments.id,
            filename: attachments.filename,
            contentType: attachments.contentType,
            sizeBytes: attachments.sizeBytes,
            width: attachments.width,
            height: attachments.height,
          })
          .from(attachments)
          .where(eq(attachments.id, reservation.attachmentId))
          .limit(1)
        if (!attachment) throw new Error('Consumed upload reservation has no attachment')
        return {
          ok: true as const,
          attachmentId: attachment.id,
          stagingKey: reservation.stagingKey,
          filename: attachment.filename,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          width: attachment.width,
          height: attachment.height,
        }
      }
      if (reservation.expiresAt.getTime() <= Date.now()) {
        return { ok: false as const, error: 'Upload reservation expired' }
      }

      const staged = await headObject({ key: reservation.stagingKey })
      if (!staged) return { ok: false as const, error: 'Uploaded object was not found' }
      const stagedError = validateReservedUpload(staged, {
        tokenHash: reservation.verificationTokenHash,
        sizeBytes: reservation.sizeBytes,
        contentType: reservation.contentType,
      })
      if (stagedError) return { ok: false as const, error: stagedError }
      if (!staged.etag) {
        return { ok: false as const, error: 'Uploaded object could not be version-verified' }
      }
      const header = await getObjectRange({
        key: reservation.stagingKey,
        start: 0,
        end: Math.min(reservation.sizeBytes - 1, 511),
        ifMatch: staged.etag,
      })
      const headerError = uploadedFileHeaderError(reservation.kind, reservation.contentType, header)
      if (headerError) return { ok: false as const, error: headerError }

      let image: Awaited<ReturnType<typeof optimizeUploadedImage>> | null = null
      if (reservation.kind === 'image') {
        const imageBody = await getObject({ key: reservation.stagingKey })
        if (imageBody.length !== reservation.sizeBytes) {
          throw new Error('Uploaded image size changed during finalization')
        }
        image = await optimizeUploadedImage({
          body: imageBody,
          contentType: reservation.contentType,
          filename: reservation.filename,
        })
      }
      if (image && image.body.length !== image.sizeBytes) {
        throw new Error('Optimized image size did not match its storage metadata')
      }
      const finalContentType = image?.contentType ?? reservation.contentType
      const finalFilename = image?.filename ?? reservation.filename
      const finalSizeBytes = image?.sizeBytes ?? reservation.sizeBytes
      const contentDisposition = uploadContentDisposition(reservation.kind, finalContentType)
      const existingFinal = await headObject({ key: reservation.r2Key })
      let promoted = false
      try {
        if (!existingFinal) {
          if (image?.optimized) {
            await putObject({
              key: reservation.r2Key,
              body: image.body,
              contentType: finalContentType,
              contentDisposition,
            })
          } else {
            await promoteObject({
              sourceKey: reservation.stagingKey,
              sourceEtag: staged.etag,
              destinationKey: reservation.r2Key,
              contentType: finalContentType,
              contentDisposition,
            })
          }
          promoted = true
        }
        const finalObject = existingFinal ?? (await headObject({ key: reservation.r2Key }))
        if (
          !finalObject ||
          finalObject.contentLength !== finalSizeBytes ||
          normalizedContentType(finalObject.contentType) !==
            normalizedContentType(finalContentType) ||
          finalObject.contentDisposition !== contentDisposition
        ) {
          if (promoted) await deleteObject({ key: reservation.r2Key })
          return { ok: false as const, error: 'Finalized object could not be verified' }
        }

        const [created] = await tx
          .insert(attachments)
          .values({
            tenantId: ctx.tenantId,
            uploadedBy: ctx.userId,
            kind: reservation.kind,
            r2Key: reservation.r2Key,
            contentType: finalContentType,
            sizeBytes: finalSizeBytes,
            filename: finalFilename,
            width: image?.width,
            height: image?.height,
          })
          .returning({ id: attachments.id })
        if (!created) throw new Error('attachment insert failed')

        const [consumed] = await tx
          .update(attachmentUploadReservations)
          .set({ attachmentId: created.id, consumedAt: new Date() })
          .where(eq(attachmentUploadReservations.id, reservation.id))
          .returning({ id: attachmentUploadReservations.id })
        if (!consumed) throw new Error('upload reservation could not be consumed')
        return {
          ok: true as const,
          attachmentId: created.id,
          stagingKey: reservation.stagingKey,
          filename: finalFilename,
          contentType: finalContentType,
          sizeBytes: finalSizeBytes,
          width: image?.width ?? null,
          height: image?.height ?? null,
        }
      } catch (error) {
        // The row lock prevents another finalizer from linking this key before
        // compensation completes. Existing finals are retained for a safe
        // retry; only a copy created by this attempt is removed.
        if (promoted) {
          try {
            await deleteObject({ key: reservation.r2Key })
          } catch (cleanupError) {
            console.error('[uploads] final-object compensation failed', {
              uploadId: reservation.id,
              cleanupError,
            })
          }
        }
        throw error
      }
    })

    if (!outcome.ok) return outcome
    try {
      await deleteObject({ key: outcome.stagingKey })
    } catch (error) {
      console.warn('[uploads] finalized staging object cleanup failed', {
        uploadId: parsed.data.uploadId,
        error,
      })
    }

    return {
      ok: true,
      attachmentId: outcome.attachmentId,
      url: attachmentUrl(outcome.attachmentId),
      filename: outcome.filename,
      contentType: outcome.contentType,
      sizeBytes: outcome.sizeBytes,
      ...(outcome.width ? { width: outcome.width } : {}),
      ...(outcome.height ? { height: outcome.height } : {}),
    }
  } catch (error) {
    try {
      await compensateUncommittedFinal(ctx, parsed.data.uploadId)
    } catch (cleanupError) {
      console.error('[uploads] uncommitted final-object reconciliation failed', {
        uploadId: parsed.data.uploadId,
        cleanupError,
      })
    }
    console.error('[uploads] upload finalization failed', {
      uploadId: parsed.data.uploadId,
      error,
    })
    return { ok: false, error: 'Upload could not be finalized' }
  }
}
