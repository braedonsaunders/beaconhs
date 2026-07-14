// Shared helpers for the PowerPoint-master surfaces: deck-target resolution
// (editor session, download route) and deck-file purge on deletion.

import { eq, inArray } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { attachments, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { deleteObject } from '@beaconhs/storage'
import type { WopiDeckTarget } from '@/lib/wopi'

type DeckMaster = {
  target: WopiDeckTarget
  targetId: string
  title: string
  backHref: string
  attachment: {
    id: string
    filename: string
    sizeBytes: number
    updatedAt: Date | null
  }
}

export function parseDeckTarget(raw: string): WopiDeckTarget | null {
  return raw === 'lesson' || raw === 'content_item' ? raw : null
}

/** Load the deck + its pptx master inside a tenant-scoped executor. Null when
 * the row is missing or the deck has no PowerPoint master. */
export async function loadDeckMaster(
  db: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>,
  target: WopiDeckTarget,
  targetId: string,
): Promise<DeckMaster | null> {
  return db(async (tx) => {
    let title: string | null = null
    let backHref = '/training'
    let sourceAttachmentId: string | null = null

    if (target === 'lesson') {
      const [row] = await tx
        .select({
          title: trainingLessons.title,
          courseId: trainingLessons.courseId,
          sourceAttachmentId: trainingLessons.sourceAttachmentId,
        })
        .from(trainingLessons)
        .where(eq(trainingLessons.id, targetId))
        .limit(1)
      if (!row) return null
      title = row.title
      backHref = `/training/courses/${row.courseId}`
      sourceAttachmentId = row.sourceAttachmentId
    } else {
      const [row] = await tx
        .select({
          title: trainingContentItems.title,
          sourceAttachmentId: trainingContentItems.sourceAttachmentId,
        })
        .from(trainingContentItems)
        .where(eq(trainingContentItems.id, targetId))
        .limit(1)
      if (!row) return null
      title = row.title
      backHref = `/training/library/${targetId}`
      sourceAttachmentId = row.sourceAttachmentId
    }

    if (!sourceAttachmentId) return null
    const [att] = await tx
      .select({
        id: attachments.id,
        filename: attachments.filename,
        sizeBytes: attachments.sizeBytes,
        updatedAt: attachments.updatedAt,
      })
      .from(attachments)
      .where(eq(attachments.id, sourceAttachmentId))
      .limit(1)
    if (!att) return null

    return { target, targetId, title: title ?? 'Slides', backHref, attachment: att }
  })
}

/**
 * Purge a deck's PPTX master when its lesson / library item is deleted.
 */
export async function purgeDeckAssets(
  db: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>,
  decks: { sourceAttachmentId: string | null }[],
): Promise<number> {
  const ids = new Set<string>()
  for (const deck of decks) {
    if (deck.sourceAttachmentId) ids.add(deck.sourceAttachmentId)
  }
  if (ids.size === 0) return 0

  const rows = await db(async (tx) => {
    const found = await tx
      .select({ id: attachments.id, key: attachments.r2Key })
      .from(attachments)
      .where(inArray(attachments.id, [...ids]))
    if (found.length > 0) {
      await tx.delete(attachments).where(
        inArray(
          attachments.id,
          found.map((r) => r.id),
        ),
      )
    }
    return found
  })
  // Objects go best-effort after the rows — a failed object delete leaves an
  // unreferenced blob, never a broken reference.
  await Promise.all(rows.map((r) => deleteObject({ key: r.key }).catch(() => {})))
  return rows.length
}
