'use server'

import { revalidatePath } from 'next/cache'
import { and, asc, eq } from 'drizzle-orm'
import { documentBookItems } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

/**
 * Persist an ordered list of documentIds for the given book. Renumbers all
 * `position` columns to keep them contiguous (0…N).
 */
export async function reorderBookItemsAction(
  bookId: string,
  orderedDocumentIds: string[],
): Promise<void> {
  const ctx = await requireRequestContext()
  if (!bookId || orderedDocumentIds.length === 0) return
  await ctx.db(async (tx) => {
    for (let i = 0; i < orderedDocumentIds.length; i++) {
      await tx
        .update(documentBookItems)
        .set({ position: i })
        .where(
          and(
            eq(documentBookItems.bookId, bookId),
            eq(documentBookItems.documentId, orderedDocumentIds[i]!),
          ),
        )
    }
  })
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: 'Reordered book items',
    after: { orderedDocumentIds },
  })
  revalidatePath(`/documents/books/${bookId}`)
}

export async function removeBookItemAction(bookId: string, documentId: string): Promise<void> {
  const ctx = await requireRequestContext()
  if (!bookId || !documentId) return
  await ctx.db(async (tx) => {
    await tx
      .delete(documentBookItems)
      .where(
        and(eq(documentBookItems.bookId, bookId), eq(documentBookItems.documentId, documentId)),
      )
    // Renumber remaining items so positions stay contiguous.
    const remaining = await tx
      .select({ id: documentBookItems.id })
      .from(documentBookItems)
      .where(eq(documentBookItems.bookId, bookId))
      .orderBy(asc(documentBookItems.position))
    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(documentBookItems)
        .set({ position: i })
        .where(eq(documentBookItems.id, remaining[i]!.id))
    }
  })
  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: 'Removed document from book',
    before: { documentId },
  })
  revalidatePath(`/documents/books/${bookId}`)
}
