'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  documentBookItems,
  documentBooks,
  documentCategories,
  documentTypes,
  type DocumentBookPrintSettings,
} from '@beaconhs/db/schema'
import { MAX_DOCUMENT_BOOK_ITEMS } from '@beaconhs/db'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  livePublishedDocumentIds,
  lockDraftDocumentBook,
  publishDocumentBook,
  unpublishDocumentBook,
} from '@/lib/document-book-lifecycle'
import { isUuid } from '@/lib/list-params'

const MAX_HEADING_TITLE = 120

/**
 * The two levels of structure above the documents. A chapter opens a major part
 * of the manual; a section groups documents inside it. Both are entries in the
 * same ordered list, so one drag moves a heading exactly like a document, and
 * the composer walks the book in printing order without a tree walk.
 */
const HEADING_KINDS = ['chapter', 'section'] as const
type HeadingKind = (typeof HEADING_KINDS)[number]

const DEFAULT_HEADING_TITLE: Record<HeadingKind, string> = {
  chapter: 'Untitled chapter',
  section: 'Untitled section',
}

type BookTx = Parameters<Parameters<Awaited<ReturnType<typeof requireRequestContext>>['db']>[0]>[0]

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
 * Keyed by entry id rather than document id: a book also holds headings, which
 * have no document, and two headings are otherwise indistinguishable.
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
 * Append a chapter or section heading under a placeholder name.
 *
 * Named on the spot rather than through a dialog: the builder puts the caret in
 * the new heading's inline title field, which is one keystroke instead of a
 * round trip through a form.
 */
export async function addBookHeadingAction(bookId: string, kind: HeadingKind): Promise<string> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  if (!HEADING_KINDS.includes(kind)) throw new Error('Choose a chapter or a section.')
  const title = DEFAULT_HEADING_TITLE[kind]

  const itemId = await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const position = await nextPosition(tx, ctx.tenantId, bookId)
    const [row] = await tx
      .insert(documentBookItems)
      .values({ tenantId: ctx.tenantId, bookId, kind, title, position })
      .returning({ id: documentBookItems.id })
    if (!row) throw new Error('Failed to add the heading.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: `Added ${kind} to book`,
      after: { kind, title, position },
    })
    return row.id
  })
  revalidatePath(`/documents/books/${bookId}`)
  return itemId
}

export async function renameBookHeadingAction(
  bookId: string,
  itemId: string,
  title: string,
): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId) || !isUuid(itemId)) throw new Error('Book entry not found.')
  const next = title.trim()
  if (!next) throw new Error('Enter a heading.')
  if (next.length > MAX_HEADING_TITLE) {
    throw new Error(`Headings are at most ${MAX_HEADING_TITLE} characters.`)
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
          // A document entry takes its title from the document; only headings
          // carry one of their own.
          inArray(documentBookItems.kind, [...HEADING_KINDS]),
        ),
      )
      .returning({ id: documentBookItems.id })
    if (!updated) throw new Error('That heading is no longer in this book.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: `Renamed heading to "${next}"`,
      after: { itemId, title: next },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

/**
 * Append published documents to the book.
 *
 * Takes a list because adding a manual's worth of documents one round trip at a
 * time is the slowest thing anyone does in this editor.
 */
export async function addDocumentsToBookAction(
  bookId: string,
  documentIds: string[],
): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  const wanted = documentIds.filter((id, index) => id && documentIds.indexOf(id) === index)
  if (wanted.length === 0) throw new Error('Pick at least one document.')
  if (wanted.some((documentId) => !isUuid(documentId))) {
    throw new Error('Book or document not found.')
  }

  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    const publishedIds = await livePublishedDocumentIds(tx, ctx.tenantId, wanted)
    if (wanted.some((documentId) => !publishedIds.has(documentId))) {
      throw new Error('Only live published documents can be added to a book.')
    }
    const existing = await tx
      .select({ documentId: documentBookItems.documentId })
      .from(documentBookItems)
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, bookId),
          inArray(documentBookItems.documentId, wanted),
        ),
      )
    const already = new Set(existing.map((row) => row.documentId))
    const fresh = wanted.filter((documentId) => !already.has(documentId))
    if (fresh.length === 0) return

    let position = await nextPosition(tx, ctx.tenantId, bookId)
    await tx.insert(documentBookItems).values(
      fresh.map((documentId) => ({
        tenantId: ctx.tenantId,
        bookId,
        documentId,
        position: position++,
      })),
    )
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(documentBookItems)
      .where(
        and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)),
      )
    if (Number(countRow?.count ?? 0) > MAX_DOCUMENT_BOOK_ITEMS) {
      throw new Error(`Document books may contain at most ${MAX_DOCUMENT_BOOK_ITEMS} entries.`)
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary:
        fresh.length === 1 ? 'Added document to book' : `Added ${fresh.length} documents to book`,
      after: { documentIds: fresh },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

export async function publishBookAction(bookId: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  await ctx.db((tx) => publishDocumentBook(tx, ctx, bookId))
  revalidatePath(`/documents/books/${bookId}`)
  revalidatePath('/documents/books')
}

export async function unpublishBookAction(bookId: string): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  await ctx.db((tx) => unpublishDocumentBook(tx, ctx, bookId))
  revalidatePath(`/documents/books/${bookId}`)
  revalidatePath('/documents/books')
}

export async function updateBookSettingsAction(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  const title = String(formData.get('title') ?? '').trim()
  const description = String(formData.get('description') ?? '').trim() || null
  const categoryId = String(formData.get('categoryId') ?? '').trim() || null
  const typeId = String(formData.get('typeId') ?? '').trim() || null
  const reviewRaw = String(formData.get('reviewFrequencyMonths') ?? '').trim()
  const reviewFrequencyMonths = reviewRaw ? Number(reviewRaw) : null
  const nextReviewOn = String(formData.get('nextReviewOn') ?? '').trim() || null
  if (!isUuid(bookId)) throw new Error('Document book not found.')
  if (!title) throw new Error('Enter a book title.')
  if (categoryId && !isUuid(categoryId)) throw new Error('Select a valid category.')
  if (typeId && !isUuid(typeId)) throw new Error('Select a valid type.')
  if (
    reviewFrequencyMonths !== null &&
    (!Number.isInteger(reviewFrequencyMonths) ||
      reviewFrequencyMonths < 1 ||
      reviewFrequencyMonths > 120)
  ) {
    throw new Error('Review frequency must be a whole number from 1 to 120 months.')
  }
  if (nextReviewOn && !/^\d{4}-\d{2}-\d{2}$/.test(nextReviewOn)) {
    throw new Error('Select a valid next review date.')
  }

  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    if (categoryId) {
      const [category] = await tx
        .select({ id: documentCategories.id })
        .from(documentCategories)
        .where(
          and(
            eq(documentCategories.tenantId, ctx.tenantId),
            eq(documentCategories.id, categoryId),
            isNull(documentCategories.deletedAt),
          ),
        )
        .limit(1)
      if (!category) throw new Error('The selected category is unavailable.')
    }
    if (typeId) {
      const [type] = await tx
        .select({ id: documentTypes.id })
        .from(documentTypes)
        .where(
          and(
            eq(documentTypes.tenantId, ctx.tenantId),
            eq(documentTypes.id, typeId),
            isNull(documentTypes.deletedAt),
          ),
        )
        .limit(1)
      if (!type) throw new Error('The selected type is unavailable.')
    }
    await tx
      .update(documentBooks)
      .set({ title, description, categoryId, typeId, reviewFrequencyMonths, nextReviewOn })
      .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.id, bookId)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: 'Updated book settings',
      after: { title, description, categoryId, typeId, reviewFrequencyMonths, nextReviewOn },
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
  revalidatePath('/documents/books')
}

const PAPER_SIZES = ['letter', 'a4', 'legal'] as const
const ORIENTATIONS = ['portrait', 'landscape'] as const
/**
 * Beyond about an inch the imported content is scaled down far enough that body
 * type stops being readable at arm's length, which is the whole point of a
 * printed manual.
 */
const MAX_CONTENT_MARGIN_MM = 25

/**
 * Persist how the book prints. Every field is explicit — the builder always
 * submits the full panel, so an absent checkbox genuinely means "off" rather
 * than "unchanged".
 */
export async function updateBookPrintSettingsAction(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const bookId = String(formData.get('bookId') ?? '')
  if (!isUuid(bookId)) throw new Error('Document book not found.')

  const paperSize = String(formData.get('paperSize') ?? 'letter')
  const orientation = String(formData.get('orientation') ?? 'portrait')
  const marginRaw = String(formData.get('contentMarginMm') ?? '').trim()
  const contentMarginMm = marginRaw === '' ? 0 : Number(marginRaw)
  if (!PAPER_SIZES.includes(paperSize as (typeof PAPER_SIZES)[number])) {
    throw new Error('Select a valid paper size.')
  }
  if (!ORIENTATIONS.includes(orientation as (typeof ORIENTATIONS)[number])) {
    throw new Error('Select a valid orientation.')
  }
  if (!Number.isFinite(contentMarginMm) || contentMarginMm < 0) {
    throw new Error('Content margin must be zero or more millimetres.')
  }
  if (contentMarginMm > MAX_CONTENT_MARGIN_MM) {
    throw new Error(`Content margin must be at most ${MAX_CONTENT_MARGIN_MM} mm.`)
  }

  const on = (name: string) => formData.get(name) === 'on'
  const printSettings: DocumentBookPrintSettings = {
    paperSize: paperSize as (typeof PAPER_SIZES)[number],
    orientation: orientation as (typeof ORIENTATIONS)[number],
    contentMarginMm: Math.round(contentMarginMm * 10) / 10,
    coverPage: on('coverPage'),
    tableOfContents: on('tableOfContents'),
    documentHeaders: on('documentHeaders'),
    documentHeadersOnOwnPage: on('documentHeadersOnOwnPage'),
    footer: on('footer'),
    documentPageBreaks: on('documentPageBreaks'),
    normalizeContent: on('normalizeContent'),
  }

  await ctx.db(async (tx) => {
    await lockDraftDocumentBook(tx, ctx.tenantId, bookId)
    await tx
      .update(documentBooks)
      .set({ printSettings })
      .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.id, bookId)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document_book',
      entityId: bookId,
      action: 'update',
      summary: 'Updated book print settings',
      after: printSettings,
    })
  })
  revalidatePath(`/documents/books/${bookId}`)
}

/** Next free `position` at the end of a book's entry list. */
async function nextPosition(tx: BookTx, tenantId: string, bookId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number>`coalesce(max(${documentBookItems.position}), -1)` })
    .from(documentBookItems)
    .where(and(eq(documentBookItems.tenantId, tenantId), eq(documentBookItems.bookId, bookId)))
  return Number(row?.max ?? -1) + 1
}

/** Keep `position` contiguous after a removal. */
async function renumber(tx: BookTx, tenantId: string, bookId: string): Promise<void> {
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
