'use server'

// Bulk-action server actions for /documents.
//
// Three actions surface in the floating bulk-action bar:
//   - bulkPublishDocuments     status='published' on N rows
//   - bulkArchiveDocuments     status='archived' on N rows
//   - bulkAddDocumentsToBook   pick a document_books row, insert
//                              document_book_items for each (idempotent)
//
// All mutations go through ctx.db (RLS auto-applies); audit log gets one row
// per affected document plus a summary entry, sharing a batchId.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { documentBookItems, documentBooks, documents } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

// "New document": create the draft and land straight on its full page — title
// and everything else are edited inline there. Form action (POST) so a
// prefetch or history re-navigation can never create a record.
export async function createDocument(): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const key = `untitled-${Math.random().toString(36).slice(2, 8)}`
  const id = await ctx.db(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({ tenantId: ctx.tenantId, key, title: 'Untitled document', status: 'draft' })
      .returning({ id: documents.id })
    if (!doc) throw new Error('Failed to create document')
    return doc.id
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: id,
    action: 'create',
    summary: 'Created document',
  })
  revalidatePath('/documents')
  redirect(`/documents/${id}`)
}

export type BulkActionResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: string }

const MAX_BULK = 500

function makeBatchId(): string {
  return `bat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export async function bulkPublishDocuments(args: {
  documentIds: string[]
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (args.documentIds.length === 0) return { ok: false, error: 'No documents selected.' }
  const ids = args.documentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: documents.id, status: documents.status, deletedAt: documents.deletedAt })
      .from(documents)
      .where(inArray(documents.id, ids))
    const editable = rows
      .filter((r) => r.deletedAt === null && r.status !== 'published')
      .map((r) => r.id)
    const skipped = rows.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx.update(documents).set({ status: 'published' }).where(inArray(documents.id, editable))
    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'document',
        entityId: id,
        action: 'publish',
        summary: 'Bulk action: published',
        after: { status: 'published' },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'document',
      action: 'publish',
      summary: `Bulk published ${result.editable.length} document${result.editable.length === 1 ? '' : 's'}`,
      metadata: { batchId, documentIds: result.editable, skipped: result.skipped },
    })
  }

  revalidatePath('/documents')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkArchiveDocuments(args: {
  documentIds: string[]
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (args.documentIds.length === 0) return { ok: false, error: 'No documents selected.' }
  const ids = args.documentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: documents.id, status: documents.status, deletedAt: documents.deletedAt })
      .from(documents)
      .where(inArray(documents.id, ids))
    const editable = rows
      .filter((r) => r.deletedAt === null && r.status !== 'archived')
      .map((r) => r.id)
    const skipped = rows.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx.update(documents).set({ status: 'archived' }).where(inArray(documents.id, editable))
    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'document',
        entityId: id,
        action: 'archive',
        summary: 'Bulk action: archived',
        after: { status: 'archived' },
        metadata: { batchId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'document',
      action: 'archive',
      summary: `Bulk archived ${result.editable.length} document${result.editable.length === 1 ? '' : 's'}`,
      metadata: { batchId, documentIds: result.editable, skipped: result.skipped },
    })
  }

  revalidatePath('/documents')
  return { ok: true, updated: result.updated, skipped: result.skipped }
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
  if (args.documentIds.length === 0) return { ok: false, error: 'No documents selected.' }
  if (!args.bookId) return { ok: false, error: 'Pick a book.' }
  const ids = args.documentIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const book = await ctx.db(async (tx) => {
    const [b] = await tx
      .select({ id: documentBooks.id, title: documentBooks.title, name: documentBooks.name })
      .from(documentBooks)
      .where(eq(documentBooks.id, args.bookId))
      .limit(1)
    return b ?? null
  })
  if (!book) return { ok: false, error: 'Book not found.' }
  const bookLabel = book.title || book.name || 'Untitled book'

  const result = await ctx.db(async (tx) => {
    const validRows = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(inArray(documents.id, ids), isNull(documents.deletedAt)))
    const validIds = validRows.map((r) => r.id)
    const skipped = ids.length - validIds.length
    if (validIds.length === 0) return { updated: 0, skipped }

    const [maxRow] = await tx
      .select({
        n: sql<number>`COALESCE(MAX(${documentBookItems.position}), 0)`,
      })
      .from(documentBookItems)
      .where(eq(documentBookItems.bookId, args.bookId))
    const startPosition = Number(maxRow?.n ?? 0)

    await tx
      .insert(documentBookItems)
      .values(
        validIds.map((documentId, idx) => ({
          tenantId: ctx.tenantId,
          bookId: args.bookId,
          documentId,
          position: startPosition + idx + 1,
        })),
      )
      .onConflictDoNothing()

    return { updated: validIds.length, skipped, validIds }
  })

  if ('validIds' in result && result.validIds) {
    for (const id of result.validIds) {
      await recordAudit(ctx, {
        entityType: 'document',
        entityId: id,
        action: 'update',
        summary: `Bulk action: added to book "${bookLabel}"`,
        metadata: { batchId, bookId: args.bookId },
      })
    }
    await recordAudit(ctx, {
      entityType: 'document',
      action: 'update',
      summary: `Bulk added ${result.validIds.length} document${result.validIds.length === 1 ? '' : 's'} to "${bookLabel}"`,
      metadata: {
        batchId,
        bookId: args.bookId,
        documentIds: result.validIds,
        skipped: result.skipped,
      },
    })
  }

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
        name: documentBooks.name,
        status: documentBooks.status,
      })
      .from(documentBooks)
      .orderBy(asc(documentBooks.title), asc(documentBooks.name))
    return rows.map((r) => ({
      id: r.id,
      label: `${r.title || r.name || 'Untitled'} (${r.status})`,
    }))
  })
}
