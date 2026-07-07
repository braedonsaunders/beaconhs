'use server'

// Content Library — reusable training material ("outside the course"). Native to
// training; same bespoke block model as inline lesson content. Gated by
// training.course.manage.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { trainingContentItems, trainingLessons, type LessonBlock } from '@beaconhs/db/schema'
import { enqueueSlidesImport } from '@beaconhs/jobs'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

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

export async function saveContentItemBlocks(id: string, blocks: LessonBlock[]) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingContentItems)
      .set({ contentBlocks: blocks })
      .where(eq(trainingContentItems.id, id))
  })
  revalidatePath(`/training/library/${id}`)
}

export async function importContentItemPptx(id: string, attachmentId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  await ctx.db(async (tx) => {
    await tx
      .update(trainingContentItems)
      .set({ importStatus: 'pending', importError: null })
      .where(eq(trainingContentItems.id, id))
  })
  await enqueueSlidesImport({
    kind: 'slides_import',
    tenantId: ctx.tenantId,
    target: 'content_item',
    targetId: id,
    attachmentId,
  })
  await recordAudit(ctx, {
    entityType: 'training_content_item',
    entityId: id,
    action: 'update',
    summary: 'Queued PowerPoint import',
    after: { attachmentId },
  })
  revalidatePath(`/training/library/${id}`)
}

export async function deleteContentItem(id: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  await ctx.db(async (tx) => {
    // Detach lessons that reference this item (content_item_id is a bare uuid).
    await tx
      .update(trainingLessons)
      .set({ contentItemId: null })
      .where(eq(trainingLessons.contentItemId, id))
    await tx
      .update(trainingContentItems)
      .set({ deletedAt: new Date() })
      .where(eq(trainingContentItems.id, id))
  })
  await recordAudit(ctx, {
    entityType: 'training_content_item',
    entityId: id,
    action: 'delete',
    summary: 'Deleted library item',
  })
  revalidatePath('/training/library')
  redirect('/training/library')
}
