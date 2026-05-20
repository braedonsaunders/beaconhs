'use server'

import { revalidatePath } from 'next/cache'
import { documentVersions, documents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function createDocument(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const title = String(formData.get('title') ?? '').trim()
  if (!title) return { ok: false, error: 'Title is required' }

  const description = String(formData.get('description') ?? '').trim() || null
  const category = String(formData.get('category') ?? '').trim() || null
  const customKey = String(formData.get('key') ?? '').trim() || null
  const reviewFrequencyMonthsRaw = String(
    formData.get('reviewFrequencyMonths') ?? '',
  ).trim()
  const reviewFrequencyMonths = reviewFrequencyMonthsRaw
    ? Number(reviewFrequencyMonthsRaw)
    : null

  // Either a rich-text HTML body OR an uploaded attachment id; both empty is
  // allowed (empty draft), but we never accept both.
  const contentHtml = String(formData.get('contentHtml') ?? '').trim() || null
  const contentAttachmentId =
    String(formData.get('contentAttachmentId') ?? '').trim() || null

  const key = customKey
    ? slugify(customKey)
    : `${slugify(title)}-${Math.random().toString(36).slice(2, 6)}`

  const nextReviewOn = reviewFrequencyMonths
    ? (() => {
        const d = new Date()
        d.setMonth(d.getMonth() + reviewFrequencyMonths)
        return d.toISOString().slice(0, 10)
      })()
    : null

  try {
    const documentId = await ctx.db(async (tx) => {
      const [doc] = await tx
        .insert(documents)
        .values({
          tenantId: ctx.tenantId,
          key,
          title,
          description,
          category,
          status: 'draft',
          reviewFrequencyMonths,
          nextReviewOn,
        })
        .returning({ id: documents.id })
      if (!doc) throw new Error('Failed to insert document')
      await tx.insert(documentVersions).values({
        tenantId: ctx.tenantId,
        documentId: doc.id,
        version: 1,
        contentMarkdown: contentHtml,
        contentAttachmentId,
      })
      return doc.id
    })

    await recordAudit(ctx, {
      entityType: 'document',
      entityId: documentId,
      action: 'create',
      summary: `Created document "${title}"`,
      after: {
        title,
        key,
        category,
        reviewFrequencyMonths,
        hasAttachment: !!contentAttachmentId,
      },
    })
    revalidatePath('/documents')
    return { ok: true, id: documentId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to create document',
    }
  }
}
