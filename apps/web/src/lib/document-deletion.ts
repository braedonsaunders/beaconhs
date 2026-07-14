import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { complianceObligations, documentBookItems, documents } from '@beaconhs/db/schema'
import {
  publishedBookDocumentIds,
  publishedBookReferencesForDocuments,
} from '@/lib/document-book-lifecycle'

type SoftDeleteDocumentsResult = {
  deletedIds: string[]
  protectedIds: string[]
  complianceProtectedIds: string[]
  publishedBookProtectedIds: string[]
  missingIds: string[]
  deletedAt: Date | null
}

/**
 * Canonical document deletion policy shared by the UI and public API.
 *
 * Callers own the transaction and audit write. Live document rows are locked
 * before the obligation check so a concurrent delete/publish cannot create an
 * orphaned requirement or leave a deleted document in a book.
 */
export async function softDeleteDocumentsInTransaction(
  tx: Database,
  tenantId: string,
  ids: readonly string[],
): Promise<SoftDeleteDocumentsResult> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) {
    return {
      deletedIds: [],
      protectedIds: [],
      complianceProtectedIds: [],
      publishedBookProtectedIds: [],
      missingIds: [],
      deletedAt: null,
    }
  }

  const rows = await tx
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenantId),
        inArray(documents.id, uniqueIds),
        isNull(documents.deletedAt),
      ),
    )
    .for('update')
  const liveIds = rows.map((row) => row.id)
  const liveSet = new Set(liveIds)
  const missingIds = uniqueIds.filter((id) => !liveSet.has(id))

  if (liveIds.length === 0) {
    return {
      deletedIds: [],
      protectedIds: [],
      complianceProtectedIds: [],
      publishedBookProtectedIds: [],
      missingIds,
      deletedAt: null,
    }
  }

  const obligations = await tx
    .select({ documentId: sql<string>`${complianceObligations.targetRef}->>'documentId'` })
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, tenantId),
        eq(complianceObligations.sourceModule, 'document'),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
        inArray(sql`${complianceObligations.targetRef}->>'documentId'`, liveIds),
      ),
    )
  const complianceProtectedSet = new Set(obligations.map((row) => row.documentId))
  const bookReferences = await publishedBookReferencesForDocuments(tx, tenantId, liveIds)
  const publishedBookProtectedSet = publishedBookDocumentIds(bookReferences)
  const protectedSet = new Set([...complianceProtectedSet, ...publishedBookProtectedSet])
  const protectedIds = liveIds.filter((id) => protectedSet.has(id))
  const complianceProtectedIds = liveIds.filter((id) => complianceProtectedSet.has(id))
  const publishedBookProtectedIds = liveIds.filter((id) => publishedBookProtectedSet.has(id))
  const deletedIds = liveIds.filter((id) => !protectedSet.has(id))

  const deletedAt = deletedIds.length > 0 ? new Date() : null
  if (deletedAt) {
    await tx
      .update(documents)
      .set({ deletedAt })
      .where(and(eq(documents.tenantId, tenantId), inArray(documents.id, deletedIds)))
    await tx
      .delete(documentBookItems)
      .where(
        and(
          eq(documentBookItems.tenantId, tenantId),
          inArray(documentBookItems.documentId, deletedIds),
        ),
      )
  }

  return {
    deletedIds,
    protectedIds,
    complianceProtectedIds,
    publishedBookProtectedIds,
    missingIds,
    deletedAt,
  }
}
