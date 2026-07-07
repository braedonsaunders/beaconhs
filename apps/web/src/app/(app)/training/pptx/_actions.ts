'use server'

// Actions for PowerPoint-mastered training decks. Collabora is THE slideshow
// editor: every editable deck is a .pptx master; slides[] is the derived
// render the worker refreshes after each save.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { attachments, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { newAttachmentKey, putObject } from '@beaconhs/storage'
import { enqueueSlidesImport } from '@beaconhs/jobs'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { buildEditorUrl, getCollaboraEditUrl } from '@/lib/collabora'
import { mintWopiToken } from '@/lib/wopi'
import { blankPptxBuffer } from '@/lib/pptx-blank'
import { loadDeckMaster, parseDeckTarget } from './_lib'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

export type PptxEditorSession =
  | { ok: true; actionUrl: string; accessToken: string; accessTokenTtl: number }
  | { ok: false; error: 'not_configured' | 'no_master' | 'unknown_target' }

/**
 * Mint a WOPI session for the inline Collabora editor: resolves the deck's
 * master, the Collabora discovery URL, and a single-file access token.
 */
export async function getPptxEditorSession(
  targetRaw: string,
  targetId: string,
): Promise<PptxEditorSession> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const target = parseDeckTarget(targetRaw)
  if (!target) return { ok: false, error: 'unknown_target' }

  const master = await loadDeckMaster(ctx.db, target, targetId)
  if (!master) return { ok: false, error: 'no_master' }

  const editUrl = await getCollaboraEditUrl()
  if (!editUrl) return { ok: false, error: 'not_configured' }

  const { token, exp } = mintWopiToken({
    attachmentId: master.attachment.id,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userName: ctx.membership?.displayName ?? 'BeaconHS user',
    target,
    targetId,
    canWrite: true,
  })
  return {
    ok: true,
    actionUrl: buildEditorUrl(editUrl, master.attachment.id),
    accessToken: token,
    accessTokenTtl: exp,
  }
}

/**
 * Start a new deck: create a blank .pptx master for a slides lesson / library
 * item and queue the initial render. Replaces any existing slides — the pptx
 * becomes the deck's single source of truth.
 */
export async function createBlankDeckMaster(targetRaw: string, targetId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId
  const target = parseDeckTarget(targetRaw)
  if (!target) throw new Error('Unknown deck target')

  const pptx = blankPptxBuffer()

  const { attachmentId, revalidate } = await ctx.db(async (tx) => {
    let title = 'Presentation'
    let revalidate = '/training/library'
    if (target === 'lesson') {
      const [row] = await tx
        .select({ title: trainingLessons.title, courseId: trainingLessons.courseId })
        .from(trainingLessons)
        .where(eq(trainingLessons.id, targetId))
        .limit(1)
      if (!row) throw new Error('Lesson not found')
      title = row.title || title
      revalidate = `/training/courses/${row.courseId}`
    } else {
      const [row] = await tx
        .select({ title: trainingContentItems.title })
        .from(trainingContentItems)
        .where(eq(trainingContentItems.id, targetId))
        .limit(1)
      if (!row) throw new Error('Library item not found')
      title = row.title || title
      revalidate = `/training/library/${targetId}`
    }

    const filename = `${title.replace(/[^\w.\- ]+/g, '').trim() || 'Presentation'}.pptx`
    const key = newAttachmentKey({ tenantId, kind: 'document', filename })
    await putObject({ key, body: pptx, contentType: PPTX_MIME })
    const [att] = await tx
      .insert(attachments)
      .values({
        tenantId,
        uploadedBy: ctx.userId,
        kind: 'document',
        r2Key: key,
        contentType: PPTX_MIME,
        sizeBytes: pptx.length,
        filename,
      })
      .returning()
    if (!att) throw new Error('Failed to create the presentation file')

    const table = target === 'lesson' ? trainingLessons : trainingContentItems
    await tx
      .update(table)
      .set({ sourceAttachmentId: att.id, importStatus: 'pending', importError: null })
      .where(eq(table.id, targetId))
    return { attachmentId: att.id, revalidate }
  })

  await enqueueSlidesImport({
    kind: 'slides_import',
    tenantId,
    target,
    targetId,
    attachmentId,
  })
  await recordAudit(ctx, {
    entityType: target === 'lesson' ? 'training_lesson' : 'training_content_item',
    entityId: targetId,
    action: 'update',
    summary: 'Started a new PowerPoint deck',
    after: { attachmentId },
  })
  revalidatePath(revalidate)
}
