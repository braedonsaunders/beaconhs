'use server'
import { and, eq } from 'drizzle-orm'
import { attachments } from '@beaconhs/db/schema'
import { getObject } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { loadMySavedSignature } from './saved-signature'
import { decodeSignatureDataUrl } from './signature-storage'

/** Supplies only this user's opted-in ink; callers still run their normal signing action. */
export async function getMySavedSignatureCapture(signerPersonId?: string) {
  const ctx = await requireRequestContext()
  if (signerPersonId !== undefined && signerPersonId !== ctx.personId) return null
  const saved = await loadMySavedSignature(ctx)
  if (!saved) return null
  const row = await ctx.db(async (tx) => {
    const [attachment] = await tx
      .select({ key: attachments.r2Key, contentType: attachments.contentType })
      .from(attachments)
      .where(
        and(
          eq(attachments.id, saved.signature.attachmentId),
          eq(attachments.tenantId, ctx.tenantId),
          eq(attachments.kind, 'signature'),
        ),
      )
      .limit(1)
    return attachment
  })
  if (!row || !['image/png', 'image/jpeg'].includes(row.contentType))
    throw new Error('Saved signature is unavailable. Draw it again in Account settings.')
  const bytes = await getObject({ key: row.key })
  const dataUrl = `data:${row.contentType};base64,${bytes.toString('base64')}`
  decodeSignatureDataUrl(dataUrl)
  return { mode: saved.mode, dataUrl }
}
