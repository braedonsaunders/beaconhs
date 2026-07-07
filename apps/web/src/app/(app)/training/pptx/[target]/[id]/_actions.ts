'use server'

// Actions for PPTX-mastered decks (shared by the course lesson surface and the
// library item editor).

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { parseDeckTarget } from './_lib'

/**
 * Detach a deck from its PowerPoint master. The last rendered slides are kept
 * and become editable again in the canvas editor; the pptx stops being the
 * source of truth (saves in the PowerPoint editor no longer re-render it).
 */
export async function detachPptxMaster(targetRaw: string, targetId: string) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'training')
  const target = parseDeckTarget(targetRaw)
  if (!target) throw new Error('Unknown deck target')

  if (target === 'lesson') {
    const courseId = await ctx.db(async (tx) => {
      const [row] = await tx
        .select({ courseId: trainingLessons.courseId })
        .from(trainingLessons)
        .where(eq(trainingLessons.id, targetId))
        .limit(1)
      if (!row) throw new Error('Lesson not found')
      await tx
        .update(trainingLessons)
        .set({ sourceAttachmentId: null })
        .where(eq(trainingLessons.id, targetId))
      return row.courseId
    })
    await recordAudit(ctx, {
      entityType: 'training_lesson',
      entityId: targetId,
      action: 'update',
      summary: 'Detached the deck from its PowerPoint master',
    })
    revalidatePath(`/training/courses/${courseId}`)
  } else {
    await ctx.db(async (tx) => {
      const [row] = await tx
        .select({ id: trainingContentItems.id })
        .from(trainingContentItems)
        .where(eq(trainingContentItems.id, targetId))
        .limit(1)
      if (!row) throw new Error('Library item not found')
      await tx
        .update(trainingContentItems)
        .set({ sourceAttachmentId: null })
        .where(eq(trainingContentItems.id, targetId))
    })
    await recordAudit(ctx, {
      entityType: 'training_content_item',
      entityId: targetId,
      action: 'update',
      summary: 'Detached the deck from its PowerPoint master',
    })
    revalidatePath(`/training/library/${targetId}`)
  }
}
