'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq } from 'drizzle-orm'
import { documentBookItems, documentBooks } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

/**
 * Instant-create a document book and land in its detail editor (the single
 * view+edit surface) — no separate create form, no create drawer. A blank
 * title defaults to a placeholder the user renames on the detail page.
 */
export async function createBook(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const title = String(formData.get('title') ?? '').trim() || 'Untitled book'
  const category = String(formData.get('category') ?? '').trim() || null
  const description = String(formData.get('description') ?? '').trim() || null

  const bookId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(documentBooks)
      .values({
        tenantId: ctx.tenantId,
        title,
        name: title, // keep legacy column populated
        description,
        category,
        status: 'draft',
      })
      .returning({ id: documentBooks.id })
    if (!row) throw new Error('Failed to insert book')
    return row.id
  })

  await recordAudit(ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'create',
    summary: `Created document book "${title}"`,
    after: { title, category, description },
  })
  revalidatePath('/documents/books')
  redirect(`/documents/books/${bookId}`)
}

/**
 * Persist an ordered list of documentIds for the given book. Renumbers all
 * `position` columns to keep them contiguous (0…N).
 */
export async function reorderBookItemsAction(
  bookId: string,
  orderedDocumentIds: string[],
): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
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
  assertCan(ctx, 'documents.manage')
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
