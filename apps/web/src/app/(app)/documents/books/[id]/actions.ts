'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, sql } from 'drizzle-orm'
import { documentBookItems, documentBooks } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { lockDraftDocumentBook } from '@/lib/document-book-lifecycle'
import { isUuid } from '@/lib/list-params'

const MAX_SECTION_TITLE = 120

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
 * Persist an ordered list of ENTRY ids for the given book, renumbering
 * `position` to stay contiguous (0…N).
 *
 * Keyed by entry id rather than document id: a book also holds section
 * dividers, which have no document, and two sections are otherwise
 * indistinguishable.
 */
export async function reorderBookItemsAction(
  bookId: string,
  orderedItemIds: string[],
): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  if (
    orderedItemIds.length === 0 ||
    orderedItemIds.some((itemId) => !isUuid(itemId)) ||
    new Set(orderedItemIds).size !== orderedItemIds.length
  ) {
    throw new Error('The contents order is invalid. Refresh the page and try again.')
  }
  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const current = await tx
      .select({ id: documentBookItems.id })
      .from(documentBookItems)
      .where(
        and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)),
      )
    const requested = new Set(orderedItemIds)
    if (
      current.length !== orderedItemIds.length ||
      current.some((item) => !requested.has(item.id))
    ) {
      throw new Error('The book contents changed. Refresh the page before reordering.')
    }
    for (let i = 0; i < orderedItemIds.length; i++) {
      await tx
        .update(documentBookItems)
        .set({ position: i })
        .where(
          and(
            eq(documentBookItems.tenantId, ctx.tenantId),
            eq(documentBookItems.bookId, bookId),
            eq(documentBookItems.id, orderedItemIds[i]!),
          ),
        )
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: 'Reordered book contents',
      after: { orderedItemIds },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

export async function removeBookItemAction(bookId: string, itemId: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId) || !isUuid(itemId)) throw new Error('Book entry not found.')
  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const [removed] = await tx
      .delete(documentBookItems)
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, bookId),
          eq(documentBookItems.id, itemId),
        ),
      )
      .returning({ id: documentBookItems.id, documentId: documentBookItems.documentId })
    if (!removed) throw new Error('That entry is no longer in this book.')
    await renumber(tx, ctx.tenantId, bookId)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: 'Removed entry from book',
      before: { itemId, documentId: removed.documentId },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

/**
 * Append a section divider.
 *
 * Sections are what make a long manual navigable — the imported "Safety Talks"
 * book is 196 documents with nothing between them. They render as a divider
 * page and group the contents listing.
 */
export async function addBookSectionAction(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  if (!title) throw new Error('Enter a section heading.')
  if (title.length > MAX_SECTION_TITLE) {
    throw new Error(`Section headings are at most ${MAX_SECTION_TITLE} characters.`)
  }

  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const [maxRow] = await tx
      .select({ max: sql<number>`coalesce(max(${documentBookItems.position}), -1)` })
      .from(documentBookItems)
      .where(
        and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)),
      )
    const position = (Number(maxRow?.max ?? -1) ?? -1) + 1
    await tx.insert(documentBookItems).values({
      tenantId: ctx.tenantId,
      bookId,
      kind: 'section',
      title,
      position,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: `Added section "${title}"`,
      after: { kind: 'section', title, position },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

export async function renameBookSectionAction(
  bookId: string,
  itemId: string,
  title: string,
): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId) || !isUuid(itemId)) throw new Error('Book entry not found.')
  const next = title.trim()
  if (!next) throw new Error('Enter a section heading.')
  if (next.length > MAX_SECTION_TITLE) {
    throw new Error(`Section headings are at most ${MAX_SECTION_TITLE} characters.`)
  }

  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const [updated] = await tx
      .update(documentBookItems)
      .set({ title: next })
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, bookId),
          eq(documentBookItems.id, itemId),
          eq(documentBookItems.kind, 'section'),
        ),
      )
      .returning({ id: documentBookItems.id })
    if (!updated) throw new Error('That section is no longer in this book.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: `Renamed section to "${next}"`,
      after: { itemId, title: next },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

/** Keep `position` contiguous after a removal. */
async function renumber(
  tx: Parameters<Parameters<Awaited<ReturnType<typeof requireRequestContext>>['db']>[0]>[0],
  tenantId: string,
  bookId: string,
): Promise<void> {
  const remaining = await tx
    .select({ id: documentBookItems.id })
    .from(documentBookItems)
    .where(and(eq(documentBookItems.tenantId, tenantId), eq(documentBookItems.bookId, bookId)))
    .orderBy(asc(documentBookItems.position), asc(documentBookItems.id))
  for (let i = 0; i < remaining.length; i++) {
    await tx
      .update(documentBookItems)
      .set({ position: i })
      .where(
        and(
          eq(documentBookItems.tenantId, tenantId),
          eq(documentBookItems.bookId, bookId),
          eq(documentBookItems.id, remaining[i]!.id),
        ),
      )
  }
}
