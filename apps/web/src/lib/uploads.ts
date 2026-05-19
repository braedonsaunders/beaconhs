'use server'

import { z } from 'zod'
import { attachments } from '@beaconhs/db/schema'
import { newAttachmentKey, presignPut, publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from './auth'

const requestSchema = z.object({
  kind: z.enum(['image', 'document', 'video', 'audio', 'signature', 'other']),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
})

const finalizeSchema = z.object({
  kind: z.enum(['image', 'document', 'video', 'audio', 'signature', 'other']),
  key: z.string().min(5).max(512),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative(),
})

export async function requestUpload(
  input: z.infer<typeof requestSchema>,
): Promise<{ ok: true; key: string; putUrl: string; publicUrl: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const key = newAttachmentKey({
    tenantId: ctx.tenantId,
    kind: parsed.data.kind,
    filename: parsed.data.filename,
  })

  try {
    const putUrl = await presignPut({
      key,
      contentType: parsed.data.contentType,
    })
    return { ok: true, key, putUrl, publicUrl: publicUrl(key) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Presign failed' }
  }
}

export async function finalizeUpload(
  input: z.infer<typeof finalizeSchema>,
): Promise<{ ok: true; attachmentId: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const parsed = finalizeSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.message }

  const [row] = await ctx.db((tx) =>
    tx
      .insert(attachments)
      .values({
        tenantId: ctx.tenantId,
        uploadedBy: ctx.userId,
        kind: parsed.data.kind,
        r2Key: parsed.data.key,
        contentType: parsed.data.contentType,
        sizeBytes: parsed.data.sizeBytes,
        filename: parsed.data.filename,
      })
      .returning(),
  )
  if (!row) return { ok: false, error: 'Insert failed' }
  return { ok: true, attachmentId: row.id }
}
