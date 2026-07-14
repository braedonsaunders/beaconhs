'use server'

// Content Library — reusable training material ("outside the course"). Gated
// by training.course.manage.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { attachments, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { validateTrainingExternalUrl } from '@/lib/training-external-url.server'
import {
  MAX_TRAINING_DURATION_MINUTES,
  optionalTrainingInteger,
  optionalTrainingText,
  optionalTrainingUuid,
  parseTrainingTags,
  requiredTrainingText,
  requireTrainingEnum,
  requireTrainingUuid,
  TRAINING_CONTENT_KINDS,
} from '@/lib/training-mutation-validation'
import { sanitizeTrainingHtml } from '@/lib/training-rich-content'
import { assertTrainingPptxAttachment } from '@/lib/training-pptx-policy'
import { purgeDeckAssets } from '../pptx/_lib'

export async function createContentItem(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const titleRaw = String(formData.get('title') ?? '').trim()
  const title = titleRaw ? requiredTrainingText(titleRaw, 'Title', 200) : 'Untitled item'
  const kind = requireTrainingEnum(
    String(formData.get('kind') ?? '').trim() || 'rich',
    TRAINING_CONTENT_KINDS,
    'Content type',
  )

  const created = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingContentItems)
      .values({ tenantId, title, kind })
      .returning()
    if (!row) throw new Error('Could not create the library item.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_content_item',
    entityId: created.id,
    action: 'create',
    summary: `Created library item "${title}"`,
  })
  revalidatePath('/training/library')
  redirect(`/training/library/${created.id}`)
}

export async function updateContentItem(id: string, formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  id = requireTrainingUuid(id, 'Library item')
  const title = requiredTrainingText(formData.get('title'), 'Title', 200)
  const kind = requireTrainingEnum(formData.get('kind'), TRAINING_CONTENT_KINDS, 'Content type')
  const description = optionalTrainingText(formData.get('description'), 'Description', 20_000)
  const embedUrlRaw = String(formData.get('embedUrl') ?? '').trim()
  const embedUrl =
    (kind === 'video' || kind === 'embed') && embedUrlRaw
      ? await validateTrainingExternalUrl(embedUrlRaw)
      : null
  const attachmentIdRaw = optionalTrainingUuid(formData.get('attachmentId'), 'Attachment')
  const attachmentId = kind === 'video' || kind === 'file' ? attachmentIdRaw : null
  const durationMinutes = optionalTrainingInteger(
    formData.get('durationMinutes'),
    'Duration',
    MAX_TRAINING_DURATION_MINUTES,
  )
  const tags = parseTrainingTags(formData.get('tags'))

  const updated = await ctx.db(async (tx) => {
    if (attachmentId) {
      const [attachment] = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(eq(attachments.id, attachmentId))
        .limit(1)
      if (!attachment) throw new Error('Attachment not found.')
    }
    const [row] = await tx
      .update(trainingContentItems)
      .set({
        title,
        kind,
        description,
        embedUrl,
        attachmentId,
        durationMinutes,
        tags,
      })
      .where(and(eq(trainingContentItems.id, id), isNull(trainingContentItems.deletedAt)))
      .returning({ id: trainingContentItems.id })
    if (!row) throw new Error('Library item not found.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_content_item',
    entityId: updated.id,
    action: 'update',
    summary: `Updated library item "${title}"`,
    after: { kind, attachmentId, durationMinutes, tags },
  })
  revalidatePath(`/training/library/${id}`)
  revalidatePath('/training/library')
}

export async function saveContentItemRich(id: string, html: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  id = requireTrainingUuid(id, 'Library item')
  if (typeof html !== 'string' || html.length > 2_000_000) throw new Error('Content too large')
  const updated = await ctx.db(async (tx) => {
    const [row] = await tx
      .update(trainingContentItems)
      .set({
        contentHtml: sanitizeTrainingHtml(html),
      })
      .where(
        and(
          eq(trainingContentItems.id, id),
          eq(trainingContentItems.kind, 'rich'),
          isNull(trainingContentItems.deletedAt),
        ),
      )
      .returning({ id: trainingContentItems.id })
    if (!row) throw new Error('Rich-text library item not found.')
    return row
  })
  await recordAudit(ctx, {
    entityType: 'training_content_item',
    entityId: updated.id,
    action: 'update',
    summary: 'Updated library item content',
  })
  revalidatePath(`/training/library/${id}`)
}

export async function importContentItemPptx(id: string, attachmentId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  id = requireTrainingUuid(id, 'Library item')
  attachmentId = requireTrainingUuid(attachmentId, 'PowerPoint attachment')
  await ctx.db(async (tx) => {
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
    const [updated] = await tx
      .update(trainingContentItems)
      .set({ sourceAttachmentId: attachmentId })
      .where(
        and(
          eq(trainingContentItems.id, id),
          eq(trainingContentItems.kind, 'slides'),
          isNull(trainingContentItems.deletedAt),
        ),
      )
      .returning({ id: trainingContentItems.id })
    if (!updated) throw new Error('Slideshow library item not found.')
  })
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
  id = requireTrainingUuid(id, 'Library item')
  const deck = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        sourceAttachmentId: trainingContentItems.sourceAttachmentId,
      })
      .from(trainingContentItems)
      .where(and(eq(trainingContentItems.id, id), isNull(trainingContentItems.deletedAt)))
      .limit(1)
    if (!row) throw new Error('Library item not found.')
    // Detach lessons that reference this item (content_item_id is a bare uuid).
    await tx
      .update(trainingLessons)
      .set({ contentItemId: null })
      .where(eq(trainingLessons.contentItemId, id))
    const [deleted] = await tx
      .update(trainingContentItems)
      .set({ deletedAt: new Date(), sourceAttachmentId: null })
      .where(and(eq(trainingContentItems.id, id), isNull(trainingContentItems.deletedAt)))
      .returning({ id: trainingContentItems.id })
    if (!deleted) throw new Error('Library item changed while it was being deleted.')
    return row
  })
  const purged = await purgeDeckAssets(ctx.db, [deck])
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
