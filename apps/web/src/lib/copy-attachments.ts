import { and, eq } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { attachments } from '@beaconhs/db/schema'
import {
  assertTenantObjectKey,
  deleteObject,
  headObject,
  newAttachmentKey,
  promoteObject,
} from '@beaconhs/storage'
import type { RequestContext } from '@beaconhs/tenant'
import { attachmentUrl } from './attachment-url'

export type AttachmentCopier = {
  attachment(tx: Database, id: string): Promise<string>
  payload(tx: Database, value: Record<string, unknown>): Promise<Record<string, unknown>>
}

/** Independent file objects prevent a copy's edits from changing the original. */
export async function withCopiedAttachments<T>(
  ctx: RequestContext,
  write: (tx: Database, copy: AttachmentCopier) => Promise<T>,
): Promise<T> {
  const keys: string[] = []
  const copied = new Map<string, string>()
  const attachment = async (tx: Database, id: string): Promise<string> => {
    const previous = copied.get(id)
    if (previous) return previous
    const [source] = await tx
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.tenantId, ctx.tenantId)))
      .limit(1)
      .for('share')
    if (!source) throw new Error('A file in the source assessment is no longer available')
    assertTenantObjectKey({ tenantId: ctx.tenantId, key: source.r2Key })
    const metadata = await headObject({ key: source.r2Key })
    if (!metadata?.etag || metadata.contentLength !== source.sizeBytes)
      throw new Error('A source file could not be verified for copying')
    const key = newAttachmentKey({
      tenantId: ctx.tenantId,
      kind: source.kind,
      filename: source.filename,
    })
    keys.push(key)
    await promoteObject({
      sourceKey: source.r2Key,
      sourceEtag: metadata.etag,
      destinationKey: key,
      contentType: source.contentType,
      contentDisposition: source.kind === 'image' ? 'inline' : 'attachment',
    })
    const {
      id: _id,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      wopiLock: _lock,
      wopiLockExpiresAt: _expires,
      wopiSaveTicket: _save,
      wopiAppliedTicket: _applied,
      ...details
    } = source
    const [row] = await tx
      .insert(attachments)
      .values({ ...details, r2Key: key, uploadedBy: ctx.userId })
      .returning({ id: attachments.id })
    if (!row) throw new Error('Copied file could not be registered')
    copied.set(id, row.id)
    return row.id
  }
  const visit = async (tx: Database, value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) {
      const result = []
      for (const item of value) result.push(await visit(tx, item))
      return result
    }
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    const entries: [string, unknown][] = []
    for (const [key, item] of Object.entries(record)) entries.push([key, await visit(tx, item)])
    const result: Record<string, unknown> = Object.fromEntries(entries)
    if (typeof record.attachmentId === 'string') {
      const id = await attachment(tx, record.attachmentId)
      result.attachmentId = id
      result.url = attachmentUrl(id)
    }
    return result
  }
  try {
    return await ctx.db((tx) =>
      write(tx, {
        attachment,
        payload: async (db, value) => (await visit(db, value)) as Record<string, unknown>,
      }),
    )
  } catch (error) {
    const cleanup = await Promise.allSettled(keys.map((key) => deleteObject({ key })))
    cleanup.forEach((result, index) => {
      if (result.status === 'rejected')
        console.error('[copy-attachments] object compensation failed', {
          key: keys[index],
          error: result.reason,
        })
    })
    throw error
  }
}
