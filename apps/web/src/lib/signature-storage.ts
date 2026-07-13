import { createHash, timingSafeEqual } from 'node:crypto'
import { attachments } from '@beaconhs/db/schema'
import { deleteObject, getObject, headObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'

const MAX_SIGNATURE_BYTES = 10 * 1024 * 1024
const DATA_URL_RE = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]*={0,2})$/s

type TenantTransaction = Parameters<Parameters<RequestContext['db']>[0]>[0]

type DecodedSignature = {
  body: Buffer
  contentType: 'image/png' | 'image/jpeg'
  extension: 'png' | 'jpg'
  sha256: string
}

export function decodeSignatureDataUrl(value: string): DecodedSignature {
  const match = DATA_URL_RE.exec(value.trim())
  if (!match || !match[2] || match[2].length % 4 !== 0) {
    throw new Error('Signature must be a base64 PNG or JPEG data URL')
  }
  const body = Buffer.from(match[2], 'base64')
  if (body.length === 0 || body.length > MAX_SIGNATURE_BYTES) {
    throw new Error('Signature file size is invalid')
  }
  if (body.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
    throw new Error('Signature base64 payload is malformed')
  }

  const contentType = match[1] as 'image/png' | 'image/jpeg'
  const isPng =
    body.length >= 8 &&
    body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const isJpeg = body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff
  if ((contentType === 'image/png' && !isPng) || (contentType === 'image/jpeg' && !isJpeg)) {
    throw new Error('Signature bytes do not match the declared image type')
  }

  return {
    body,
    contentType,
    extension: contentType === 'image/png' ? 'png' : 'jpg',
    sha256: createHash('sha256').update(body).digest('hex'),
  }
}

function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Store a captured signature and its owning domain mutation as one saga.
 * The attachment row and domain FK share a tenant DB transaction; any DB
 * failure compensates by deleting the uploaded object.
 */
export async function withStoredSignatureAttachment<T>(
  ctx: RequestContext,
  value: string | null | undefined,
  write: (tx: TenantTransaction, attachmentId: string | null) => Promise<T>,
): Promise<T> {
  const normalized = (value ?? '').trim()
  if (!normalized) return ctx.db((tx) => write(tx, null))

  const decoded = decodeSignatureDataUrl(normalized)
  const filename = `signature.${decoded.extension}`
  const key = newAttachmentKey({ tenantId: ctx.tenantId, kind: 'signature', filename })
  await putObject({
    key,
    body: decoded.body,
    contentType: decoded.contentType,
    contentDisposition: 'inline',
  })

  try {
    const [metadata, storedBytes] = await Promise.all([headObject({ key }), getObject({ key })])
    const storedHash = createHash('sha256').update(storedBytes).digest('hex')
    if (
      !metadata ||
      metadata.contentLength !== decoded.body.length ||
      metadata.contentType?.split(';', 1)[0]?.toLowerCase() !== decoded.contentType ||
      !hashesEqual(storedHash, decoded.sha256)
    ) {
      throw new Error('Stored signature failed integrity verification')
    }

    return await ctx.db(async (tx) => {
      const [attachment] = await tx
        .insert(attachments)
        .values({
          tenantId: ctx.tenantId,
          uploadedBy: ctx.userId,
          kind: 'signature',
          r2Key: key,
          contentType: decoded.contentType,
          sizeBytes: decoded.body.length,
          filename,
        })
        .returning({ id: attachments.id })
      if (!attachment) throw new Error('Signature attachment could not be registered')
      return write(tx, attachment.id)
    })
  } catch (error) {
    try {
      await deleteObject({ key })
    } catch (cleanupError) {
      console.error('[signature-storage] object compensation failed', { key, cleanupError })
    }
    throw error
  }
}
