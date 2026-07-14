import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { MAX_DOCUMENT_BOOK_ITEMS, resolveDocumentBookItems, type Database } from '@beaconhs/db'
import {
  attachments,
  documentBookItems,
  documentBooks,
  documentVersions,
  documents,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { recordAuditInTransaction } from '@/lib/audit'

type BookRow = {
  id: string
  title: string
  status: 'draft' | 'published'
}

type PublishedBookReference = {
  documentId: string
  bookId: string
  bookTitle: string
}

/**
 * Lock a book before any settings or membership mutation.
 *
 * Every mutation uses the book row as the serialization mutex. That makes the
 * publish snapshot atomic with add/remove/reorder operations and ensures a
 * published book cannot be edited until it is explicitly unpublished.
 */
export async function lockDraftDocumentBook(
  tx: Database,
  tenantId: string,
  bookId: string,
): Promise<BookRow> {
  const [book] = await tx
    .select({ id: documentBooks.id, title: documentBooks.title, status: documentBooks.status })
    .from(documentBooks)
    .where(and(eq(documentBooks.tenantId, tenantId), eq(documentBooks.id, bookId)))
    .limit(1)
    .for('update')
  if (!book) throw new Error('Document book not found.')
  if (book.status !== 'draft') {
    throw new Error('Unpublish the book before changing its settings or contents.')
  }
  return book
}

/** Return published books that currently contain any of the supplied documents. */
export async function publishedBookReferencesForDocuments(
  tx: Database,
  tenantId: string,
  documentIds: readonly string[],
): Promise<PublishedBookReference[]> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) return []

  return tx
    .select({
      documentId: documentBookItems.documentId,
      bookId: documentBooks.id,
      bookTitle: documentBooks.title,
    })
    .from(documentBookItems)
    .innerJoin(
      documentBooks,
      and(
        eq(documentBooks.tenantId, documentBookItems.tenantId),
        eq(documentBooks.id, documentBookItems.bookId),
      ),
    )
    .where(
      and(
        eq(documentBookItems.tenantId, tenantId),
        inArray(documentBookItems.documentId, ids),
        eq(documentBooks.status, 'published'),
      ),
    )
    .orderBy(asc(documentBooks.title), asc(documentBooks.id))
}

export function publishedBookDocumentIds(
  references: readonly PublishedBookReference[],
): Set<string> {
  return new Set(references.map((reference) => reference.documentId))
}

function publishedBookMutationError(reference: PublishedBookReference): string {
  const title = reference.bookTitle.trim() || 'Untitled book'
  return `Unpublish the document book "${title}" before unpublishing, archiving, or deleting this document.`
}

export async function assertDocumentNotInPublishedBook(
  tx: Database,
  tenantId: string,
  documentId: string,
): Promise<void> {
  const [reference] = await publishedBookReferencesForDocuments(tx, tenantId, [documentId])
  if (reference) throw new Error(publishedBookMutationError(reference))
}

type PublishableBookItem = {
  itemId: string
  documentId: string
  documentTitle: string
  documentKey: string
  documentStatus: (typeof documents.$inferSelect)['status']
  documentDeletedAt: Date | null
  pinnedVersionId: string | null
}

type PublishableVersion = {
  id: string
  documentId: string
  version: number
  pdfAttachmentId: string | null
  contentAttachmentId: string | null
}

/**
 * Publish a book by pinning every member to its latest immutable published PDF
 * version in the same transaction as the status change and audit record.
 */
export async function publishDocumentBook(
  tx: Database,
  ctx: RequestContext,
  bookId: string,
): Promise<boolean> {
  const [book] = await tx
    .select({ id: documentBooks.id, title: documentBooks.title, status: documentBooks.status })
    .from(documentBooks)
    .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.id, bookId)))
    .limit(1)
    .for('update')
  if (!book) throw new Error('Document book not found.')
  if (book.status === 'published') return false

  const items: PublishableBookItem[] = await tx
    .select({
      itemId: documentBookItems.id,
      documentId: documentBookItems.documentId,
      documentTitle: documents.title,
      documentKey: documents.key,
      documentStatus: documents.status,
      documentDeletedAt: documents.deletedAt,
      pinnedVersionId: documentBookItems.documentVersionId,
    })
    .from(documentBookItems)
    .innerJoin(
      documents,
      and(
        eq(documents.tenantId, documentBookItems.tenantId),
        eq(documents.id, documentBookItems.documentId),
      ),
    )
    .where(and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)))
    .orderBy(asc(documentBookItems.position), asc(documentBookItems.id))
    .limit(MAX_DOCUMENT_BOOK_ITEMS + 1)
    .for('update', { of: documents })

  if (items.length === 0) {
    resolveDocumentBookItems({ mode: 'publish', items, versions: [], attachments: [] })
  }

  const documentIds = items.map((item) => item.documentId)
  const versions: PublishableVersion[] = await tx
    .selectDistinctOn([documentVersions.documentId], {
      id: documentVersions.id,
      documentId: documentVersions.documentId,
      version: documentVersions.version,
      pdfAttachmentId: documentVersions.pdfAttachmentId,
      contentAttachmentId: documentVersions.contentAttachmentId,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.tenantId, ctx.tenantId),
        inArray(documentVersions.documentId, documentIds),
        isNotNull(documentVersions.publishedAt),
      ),
    )
    .orderBy(asc(documentVersions.documentId), desc(documentVersions.version))
  const attachmentIds = [
    ...new Set(
      versions
        .map((version) => version.pdfAttachmentId ?? version.contentAttachmentId)
        .filter((id): id is string => id !== null),
    ),
  ]
  const attachmentRows =
    attachmentIds.length === 0
      ? []
      : await tx
          .select({
            id: attachments.id,
            key: attachments.r2Key,
            kind: attachments.kind,
            contentType: attachments.contentType,
            sizeBytes: attachments.sizeBytes,
          })
          .from(attachments)
          .where(
            and(eq(attachments.tenantId, ctx.tenantId), inArray(attachments.id, attachmentIds)),
          )
  const pins = resolveDocumentBookItems({
    mode: 'publish',
    items,
    versions,
    attachments: attachmentRows,
  })

  for (const pin of pins) {
    const [updated] = await tx
      .update(documentBookItems)
      .set({ documentVersionId: pin.versionId })
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, bookId),
          eq(documentBookItems.id, pin.itemId),
          eq(documentBookItems.documentId, pin.documentId),
        ),
      )
      .returning({ id: documentBookItems.id })
    if (!updated) throw new Error('The book contents changed while it was being published.')
  }

  const publishedAt = new Date()
  const [published] = await tx
    .update(documentBooks)
    .set({ status: 'published', publishedAt, publishedByUserId: ctx.userId })
    .where(
      and(
        eq(documentBooks.tenantId, ctx.tenantId),
        eq(documentBooks.id, bookId),
        eq(documentBooks.status, 'draft'),
      ),
    )
    .returning({ id: documentBooks.id })
  if (!published) throw new Error('The book changed while it was being published.')

  await recordAuditInTransaction(tx, ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'publish',
    summary: 'Published document book',
    after: {
      status: 'published',
      publishedAt,
      items: pins.map((pin) => ({
        documentId: pin.documentId,
        documentVersionId: pin.versionId,
        version: pin.version,
      })),
    },
  })
  return true
}

/** Unpublish a book and remove every version pin so the draft can be edited. */
export async function unpublishDocumentBook(
  tx: Database,
  ctx: RequestContext,
  bookId: string,
): Promise<boolean> {
  const [book] = await tx
    .select({ id: documentBooks.id, title: documentBooks.title, status: documentBooks.status })
    .from(documentBooks)
    .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.id, bookId)))
    .limit(1)
    .for('update')
  if (!book) throw new Error('Document book not found.')

  const pinnedItems = await tx
    .select({ id: documentBookItems.id })
    .from(documentBookItems)
    .where(
      and(
        eq(documentBookItems.tenantId, ctx.tenantId),
        eq(documentBookItems.bookId, bookId),
        isNotNull(documentBookItems.documentVersionId),
      ),
    )
  if (book.status === 'draft' && pinnedItems.length === 0) return false

  await tx
    .update(documentBookItems)
    .set({ documentVersionId: null })
    .where(and(eq(documentBookItems.tenantId, ctx.tenantId), eq(documentBookItems.bookId, bookId)))
  await tx
    .update(documentBooks)
    .set({ status: 'draft', publishedAt: null, publishedByUserId: null })
    .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.id, bookId)))
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'document_book',
    entityId: bookId,
    action: 'update',
    summary: 'Unpublished document book (set to draft)',
    before: { status: book.status, pinnedItemCount: pinnedItems.length },
    after: { status: 'draft', pinnedItemCount: 0 },
  })
  return true
}

/** Return the subset of requested documents that are live and published. */
export async function livePublishedDocumentIds(
  tx: Database,
  tenantId: string,
  documentIds: readonly string[],
): Promise<Set<string>> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) return new Set()
  const rows = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        inArray(documents.id, ids),
        eq(documents.status, 'published'),
        isNull(documents.deletedAt),
      ),
    )
  return new Set(rows.map((row) => row.id))
}
