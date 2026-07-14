'use server'

// Content Library — reusable training material ("outside the course"). Gated
// by training.course.manage.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq } from 'drizzle-orm'
import { attachments, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { purgeDeckAssets } from '../pptx/_lib'
import { assertTrainingPptxAttachment } from '@/lib/training-pptx-policy'

type ContentKind = 'rich' | 'video' | 'file' | 'embed' | 'slides'

export async function createContentItem(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const title = String(formData.get('title') ?? '').trim() || 'Untitled item'
  const kind = (String(formData.get('kind') ?? 'rich').trim() || 'rich') as ContentKind

  const created = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingContentItems)
      .values({ tenantId, title, kind })
      .returning()
    return row
  })
  if (created) {
    await recordAudit(ctx, {
      entityType: 'training_content_item',
      entityId: created.id,
      action: 'create',
      summary: `Created library item "${title}"`,
    })
  }
  revalidatePath('/training/library')
  if (created) redirect(`/training/library/${created.id}`)
  redirect('/training/library')
}

export async function updateContentItem(id: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const title = String(formData.get('title') ?? '').trim()
  const kindRaw = String(formData.get('kind') ?? '').trim() as ContentKind | ''
  const description = String(formData.get('description') ?? '').trim() || null
  const embedUrl = String(formData.get('embedUrl') ?? '').trim() || null
  const attachmentId = String(formData.get('attachmentId') ?? '').trim() || null
  const durationRaw = String(formData.get('durationMinutes') ?? '').trim()
  const durationMinutes = durationRaw ? Math.max(0, Number(durationRaw) || 0) : null
  const tags = String(formData.get('tags') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  await ctx.db(async (tx) => {
    await tx
      .update(trainingContentItems)
      .set({
        ...(title ? { title } : {}),
        ...(kindRaw ? { kind: kindRaw } : {}),
        description,
        embedUrl,
        attachmentId,
        durationMinutes,
        tags,
      })
      .where(eq(trainingContentItems.id, id))
  })
  revalidatePath(`/training/library/${id}`)
  revalidatePath('/training/library')
}

export async function saveContentItemRich(id: string, json: unknown, html: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Content too large')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingContentItems)
      .set({
        contentJson: (json ?? null) as Record<string, unknown> | null,
        contentHtml: sanitizeDocumentHtml(html),
      })
      .where(eq(trainingContentItems.id, id))
  })
  revalidatePath(`/training/library/${id}`)
}

export async function importContentItemPptx(id: string, attachmentId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const replacedAttachmentId = await ctx.db(async (tx) => {
    const [attachment] = await tx
      .select({
        kind: attachments.kind,
        contentType: attachments.contentType,
        sizeBytes: attachments.sizeBytes,
      })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1)
    if (!attachment) throw new Error('PowerPoint attachment not found.')
    assertTrainingPptxAttachment(attachment)

    const [existing] = await tx
      .select({ sourceAttachmentId: trainingContentItems.sourceAttachmentId })
      .from(trainingContentItems)
      .where(eq(trainingContentItems.id, id))
      .limit(1)
    if (!existing) throw new Error('Slideshow library item not found.')

    const [updated] = await tx
      .update(trainingContentItems)
      .set({ sourceAttachmentId: attachmentId })
      .where(and(eq(trainingContentItems.id, id), eq(trainingContentItems.kind, 'slides')))
      .returning({ id: trainingContentItems.id })
    if (!updated) throw new Error('Slideshow library item not found.')
    return existing.sourceAttachmentId && existing.sourceAttachmentId !== attachmentId
      ? existing.sourceAttachmentId
      : null
  })
  if (replacedAttachmentId) {
    await purgeDeckAssets(ctx.db, [{ sourceAttachmentId: replacedAttachmentId }])
  }
  await recordAudit(ctx, {
    entityType: 'training_content_item',
    entityId: id,
    action: 'update',
    summary: 'Imported PowerPoint master',
    after: { attachmentId },
  })
  revalidatePath(`/training/library/${id}`)
}

export async function deleteContentItem(id: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const deck = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        slides: trainingContentItems.slides,
        sourceAttachmentId: trainingContentItems.sourceAttachmentId,
      })
      .from(trainingContentItems)
      .where(eq(trainingContentItems.id, id))
      .limit(1)
    // Detach lessons that reference this item (content_item_id is a bare uuid).
    await tx
      .update(trainingLessons)
      .set({ contentItemId: null })
      .where(eq(trainingLessons.contentItemId, id))
    await tx
      .update(trainingContentItems)
      .set({ deletedAt: new Date(), slides: [], sourceAttachmentId: null })
      .where(eq(trainingContentItems.id, id))
    return row ?? null
  })
  const purged = deck ? await purgeDeckAssets(ctx.db, [deck]) : 0
  await recordAudit(ctx, {
    entityType: 'training_content_item',
    entityId: id,
    action: 'delete',
    summary: 'Deleted library item',
    metadata: purged ? { purgedAttachments: purged } : {},
  })
  revalidatePath('/training/library')
  redirect('/training/library')
}
