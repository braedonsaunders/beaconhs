'use server'

import { revalidatePath } from 'next/cache'
import { documentReferences } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export async function createReference(input: {
  title: string
  description: string | null
  category: string | null
  kind: 'url' | 'attachment'
  url: string | null
  attachmentId: string | null
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!input.title.trim()) return { ok: false, error: 'Title is required' }
  if (input.kind === 'url' && !input.url) return { ok: false, error: 'URL is required' }
  if (input.kind === 'attachment' && !input.attachmentId)
    return { ok: false, error: 'File upload is required' }

  const refId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(documentReferences)
      .values({
        tenantId: ctx.tenantId,
        title: input.title.trim(),
        description: input.description,
        category: input.category,
        kind: input.kind,
        url: input.kind === 'url' ? input.url : null,
        attachmentId: input.kind === 'attachment' ? input.attachmentId : null,
      })
      .returning({ id: documentReferences.id })
    if (!row) throw new Error('Failed to insert reference')
    return row.id
  })

  await recordAudit(ctx, {
    entityType: 'document_reference',
    entityId: refId,
    action: 'create',
    summary: `Created reference "${input.title}"`,
    after: { title: input.title, category: input.category, kind: input.kind },
  })
  revalidatePath('/documents/reference')
  return { ok: true, id: refId }
}
