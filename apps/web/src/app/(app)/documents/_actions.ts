'use server'

// Bulk-action server actions for /documents.
//
// Three actions surface in the floating bulk-action bar:
//   - bulkArchiveDocuments     status='archived' on N rows
//   - bulkAddDocumentsToBook   pick a document_books row, insert
//                              document_book_items for each (idempotent)
//   - bulkDeleteDocuments      soft-delete eligible documents
//
// All mutations go through ctx.db (RLS auto-applies); audit log gets one row
// per affected document plus a summary entry, sharing a batchId.

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { documentBookItems, documentBooks, documents } from '@beaconhs/db/schema'
import { MAX_DOCUMENT_BOOK_ITEMS } from '@beaconhs/db'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit, recordAuditInTransaction } from '@/lib/audit'
import { isBulkActionId, newBulkActionBatchId, parseBulkActionIds } from '@/lib/bulk-actions'
import { softDeleteDocumentsInTransaction } from '@/lib/document-deletion'
import {
  livePublishedDocumentIds,
  lockDraftDocumentBook,
  publishedBookDocumentIds,
  publishedBookReferencesForDocuments,
} from '@/lib/document-book-lifecycle'

// "New document": create the draft and land straight on its full page — title
// and everything else are edited inline there. Form action (POST) so a
// prefetch or history re-navigation can never create a record.
export async function createDocument(): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const key = `untitled-${randomUUID()}`
  const id = await ctx.db(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({ tenantId: ctx.tenantId, key, title: 'Untitled document', status: 'draft' })
      .returning({ id: documents.id })
    if (!doc) throw new Error('Failed to create document')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document',
      entityId: doc.id,
      action: 'create',
      summary: 'Created document',
      after: { key, title: 'Untitled document', status: 'draft' },
    })
    return doc.id
  })
  revalidatePath('/documents')
  redirect(`/documents/${id}`)
}

type BulkActionResult =
  { ok: true; updated: number; skipped: number } | { ok: false; error: string }

export async function bulkArchiveDocuments(args: {
  documentIds: string[]
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const parsedIds = parseBulkActionIds(args?.documentIds, {
    singular: 'document',
    plural: 'documents',
  })
  if (!parsedIds.ok) return parsedIds
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: documents.id, status: documents.status, deletedAt: documents.deletedAt })
      .from(documents)
      .where(and(eq(documents.tenantId, ctx.tenantId), inArray(documents.id, ids)))
      .for('update')
    const bookReferences = await publishedBookReferencesForDocuments(tx, ctx.tenantId, ids)
    const bookProtectedIds = publishedBookDocumentIds(bookReferences)
    const editable = rows
      .filter(
        (row) =>
          row.deletedAt === null && row.status !== 'archived' && !bookProtectedIds.has(row.id),
      )
      .map((r) => r.id)
    const skipped = ids.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx
      .update(documents)
      .set({ status: 'archived' })
      .where(and(eq(documents.tenantId, ctx.tenantId), inArray(documents.id, editable)))
    for (const id of editable) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'document',
        entityId: id,
        action: 'archive',
        summary: 'Bulk action: archived',
        after: { status: 'archived' },
        metadata: { batchId },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'document',
      action: 'archive',
      summary: `Bulk archived ${editable.length} document${editable.length === 1 ? '' : 's'}`,
      metadata: { batchId, documentIds: editable, skipped, publishedBookBlocked: bookReferences },
    })
    return { updated: editable.length, skipped }
  })

  revalidatePath('/documents')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

// Soft-delete: the document leaves every list and its editor sessions stop
// minting (queries filter deletedAt); versions, acknowledgments and audit
// history stay intact. Book memberships are removed so books never render a
// deleted member. Documents targeted by an active compliance obligation or
// pinned into a published book are skipped — either deletion would invalidate
// a live requirement or publication.
async function softDeleteDocuments(
  ctx: Awaited<ReturnType<typeof requireRequestContext>>,
  ids: string[],
  batchId?: string,
): Promise<{ deleted: string[]; protectedIds: string[]; missingIds: string[] }> {
  return ctx.db(async (tx) => {
    const result = await softDeleteDocumentsInTransaction(tx, ctx.tenantId, ids)
    for (const id of result.deletedIds) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'document',
        entityId: id,
        action: 'delete',
        summary: batchId ? 'Bulk action: deleted' : 'Document deleted',
        metadata: batchId ? { batchId } : undefined,
      })
    }
    return {
      deleted: result.deletedIds,
      protectedIds: result.protectedIds,
      missingIds: result.missingIds,
    }
  })
}

/** Delete one document from its page (form action). */
export async function deleteDocument(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Missing document id')

  const { deleted, protectedIds } = await softDeleteDocuments(ctx, [id])
  if (deleted.length === 0) {
    if (protectedIds.includes(id)) {
      throw new Error(
        'This document is required by an active compliance obligation or a published book. End the obligation or unpublish the book first.',
      )
    }
    throw new Error('Document not found.')
  }
  revalidatePath('/documents')
  redirect('/documents')
}

export async function bulkDeleteDocuments(args: {
  documentIds: string[]
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const parsedIds = parseBulkActionIds(args?.documentIds, {
    singular: 'document',
    plural: 'documents',
  })
  if (!parsedIds.ok) return parsedIds
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const { deleted, protectedIds, missingIds } = await softDeleteDocuments(ctx, ids, batchId)
  const blocked = protectedIds.length + missingIds.length
  if (deleted.length === 0 && blocked > 0) {
    return {
      ok: false,
      error:
        'Nothing deleted — the selected documents are required by active obligations or published books.',
    }
  }

  if (deleted.length > 0) {
    await recordAudit(ctx, {
      entityType: 'document',
      action: 'delete',
      summary: `Bulk deleted ${deleted.length} document${deleted.length === 1 ? '' : 's'}`,
      metadata: { batchId, documentIds: deleted, skipped: blocked },
    })
  }

  revalidatePath('/documents')
  return { ok: true, updated: deleted.length, skipped: blocked }
}

/**
 * Insert a document_book_items row for each selected doc. Idempotent via
 * onConflictDoNothing (the table has a unique (bookId, documentId) index).
 * Position is auto-appended: max(position) + 1 + offset.
 */
export async function bulkAddDocumentsToBook(args: {
  documentIds: string[]
  bookId: string
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const parsedIds = parseBulkActionIds(args?.documentIds, {
    singular: 'document',
    plural: 'documents',
  })
  if (!parsedIds.ok) return parsedIds
  if (!isBulkActionId(args?.bookId)) return { ok: false, error: 'Pick a book.' }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    const book = await lockDraftDocumentBook(tx, ctx.tenantId, args.bookId)
    const publishedIds = await livePublishedDocumentIds(tx, ctx.tenantId, ids)
    const validIds = ids.filter((id) => publishedIds.has(id))
    const skipped = ids.length - validIds.length
    if (validIds.length === 0) return { updated: 0, skipped, bookLabel: book.title }
    const existingRows = await tx
      .select({ documentId: documentBookItems.documentId })
      .from(documentBookItems)
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, args.bookId),
          inArray(documentBookItems.documentId, validIds),
        ),
      )
    const existingIds = new Set(existingRows.map((row) => row.documentId))
    const addIds = validIds.filter((id) => !existingIds.has(id))
    if (addIds.length === 0) {
      return { updated: 0, skipped: ids.length, bookLabel: book.title }
    }

    const [maxRow] = await tx
      .select({
        n: sql<number>`COALESCE(MAX(${documentBookItems.position}), -1)`,
      })
      .from(documentBookItems)
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, args.bookId),
        ),
      )
    const startPosition = Number(maxRow?.n ?? 0)

    const added = await tx
      .insert(documentBookItems)
      .values(
        addIds.map((documentId, idx) => ({
          tenantId: ctx.tenantId,
          bookId: args.bookId,
          documentId,
          position: startPosition + idx + 1,
        })),
      )
      .onConflictDoNothing()
      .returning({ documentId: documentBookItems.documentId })

    const [countRow] = await tx
      .select({ count: sql<number>`count(*)` })
      .from(documentBookItems)
      .where(
        and(
          eq(documentBookItems.tenantId, ctx.tenantId),
          eq(documentBookItems.bookId, args.bookId),
        ),
      )
    if (Number(countRow?.count ?? 0) > MAX_DOCUMENT_BOOK_ITEMS) {
      throw new Error(`Document books may contain at most ${MAX_DOCUMENT_BOOK_ITEMS} documents.`)
    }

    const addedIds = added.map((row) => row.documentId)
    const bookLabel = book.title || 'Untitled book'
    for (const id of addedIds) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'document',
        entityId: id,
        action: 'update',
        summary: `Bulk action: added to book "${bookLabel}"`,
        metadata: { batchId, bookId: args.bookId },
      })
    }
    if (addedIds.length > 0) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'document',
        action: 'update',
        summary: `Bulk added ${addedIds.length} document${addedIds.length === 1 ? '' : 's'} to "${bookLabel}"`,
        metadata: {
          batchId,
          bookId: args.bookId,
          documentIds: addedIds,
          skipped: ids.length - addedIds.length,
        },
      })
    }
    return { updated: addedIds.length, skipped: ids.length - addedIds.length, bookLabel }
  })

  revalidatePath('/documents')
  revalidatePath(`/documents/books/${args.bookId}`)
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

// ---------- Lookups (used by bulk-bar dropdowns) ----------------------------

export async function listDocumentBooksForBulk(): Promise<{ id: string; label: string }[]> {
  const ctx = await requireRequestContext()
  return ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: documentBooks.id,
        title: documentBooks.title,
        status: documentBooks.status,
      })
      .from(documentBooks)
      .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.status, 'draft')))
      .orderBy(asc(documentBooks.title))
    return rows.map((r) => ({
      id: r.id,
      label: `${r.title || 'Untitled'} (${r.status})`,
    }))
  })
}
