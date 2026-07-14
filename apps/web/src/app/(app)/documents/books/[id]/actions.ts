'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq } from 'drizzle-orm'
import { documentBookItems, documentBooks } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { lockDraftDocumentBook } from '@/lib/document-book-lifecycle'
import { isUuid } from '@/lib/list-params'

/**
 * Instant-create a document book and land in its detail editor (the single
 * view+edit surface) — no separate create form, no create drawer. A blank
 * title defaults to a placeholder the user renames on the detail page.
 */
export async function createBook(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const title = String(formData.get('title') ?? '').trim() || 'Untitled book'
  const description = String(formData.get('description') ?? '').trim() || null

  const bookId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(documentBooks)
      .values({
        tenantId: ctx.tenantId,
        title,
        description,
        status: 'draft',
      })
      .returning({ id: documentBooks.id })
    if (!row) throw new Error('Failed to insert book')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: row.id,
      action: 'create',
      summary: `Created document book "${title}"`,
      after: { title, description, status: 'draft' },
    })
    return row.id
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
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  if (
    orderedDocumentIds.length === 0 ||
    orderedDocumentIds.some((documentId) => !isUuid(documentId)) ||
    new Set(orderedDocumentIds).size !== orderedDocumentIds.length
  ) {
    throw new Error('The document order is invalid. Refresh the page and try again.')
  }
  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const current = await tx
      .select({ documentId: documentBookItems.documentId })
      .from(documentBookItems)
      .where(
        and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)),
      )
      .orderBy(asc(documentBookItems.position), asc(documentBookItems.id))
    const requested = new Set(orderedDocumentIds)
    if (
      current.length !== orderedDocumentIds.length ||
      current.some((item) => !requested.has(item.documentId))
    ) {
      throw new Error('The book contents changed. Refresh the page before reordering.')
    }
    for (let i = 0; i < orderedDocumentIds.length; i++) {
      await tx
        .update(documentBookItems)
        .set({ position: i })
        .where(
          and(
            eq(documentBookItems.tenantId, ctx.tenantId),
            eq(documentBookItems.bookId, bookId),
            eq(documentBookItems.documentId, orderedDocumentIds[i]!),
          ),
        )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: 'Reordered book items',
      after: { orderedDocumentIds },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

export async function removeBookItemAction(bookId: string, documentId: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId) || !isUuid(documentId)) throw new Error('Book or document not found.')
  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const [removed] = await tx
      .delete(documentBookItems)
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, bookId),
          eq(documentBookItems.documentId, documentId),
        ),
      )
      .returning({ id: documentBookItems.id })
    if (!removed) throw new Error('That document is no longer in this book.')
    // Renumber remaining items so positions stay contiguous.
    const remaining = await tx
      .select({ id: documentBookItems.id })
      .from(documentBookItems)
      .where(
        and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)),
      )
      .orderBy(asc(documentBookItems.position), asc(documentBookItems.id))
    for (let i = 0; i < remaining.length; i++) {
      await tx
        .update(documentBookItems)
        .set({ position: i })
        .where(
          and(
            eq(documentBookItems.tenantId, ctx.tenantId),
            eq(documentBookItems.bookId, bookId),
            eq(documentBookItems.id, remaining[i]!.id),
          ),
        )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: 'Removed document from book',
      before: { documentId },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}
