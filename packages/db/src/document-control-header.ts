import { and, asc, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import type { Database } from './client'
import {
  documents,
  documentCategories,
  documentTypes,
  documentVersions,
  documentManagementReviewDocuments,
  documentManagementReviews,
  tenantUsers,
  users,
  type DocumentControlHeader,
} from './schema'

/** The same control facts serve individual documents and document books. */
export async function loadDocumentControlHeaders(
  tx: Pick<Database, 'select'>,
  tenantId: string,
  documentIds: string[],
): Promise<Map<string, DocumentControlHeader>> {
  const result = new Map<string, DocumentControlHeader>()
  if (documentIds.length === 0) return result
  const metadata = await tx
    .select({
      id: documents.id,
      title: documents.title,
      key: documents.key,
      category: documentCategories.name,
      type: documentTypes.name,
      status: documents.status,
      headerIssuedOn: documents.headerIssuedOn,
      headerRevisedOn: documents.headerRevisedOn,
      headerApprovedBy: documents.headerApprovedBy,
      headerVersionLabel: documents.headerVersionLabel,
    })
    .from(documents)
    .leftJoin(
      documentCategories,
      and(
        eq(documentCategories.tenantId, documents.tenantId),
        eq(documentCategories.id, documents.categoryId),
      ),
    )
    .leftJoin(
      documentTypes,
      and(eq(documentTypes.tenantId, documents.tenantId), eq(documentTypes.id, documents.typeId)),
    )
    .where(and(eq(documents.tenantId, tenantId), inArray(documents.id, documentIds)))
  for (const row of metadata) {
    result.set(row.id, {
      title: row.title,
      key: row.key,
      category: row.category,
      type: row.type,
      issuedAt: row.headerIssuedOn,
      revisedAt: row.headerRevisedOn,
      approvedBy: row.headerApprovedBy,
      version: row.headerVersionLabel || 'Draft',
    })
  }
  const metadataById = new Map(metadata.map((row) => [row.id, row]))
  const published = await tx
    .select({
      documentId: documentVersions.documentId,
      publishedAt: documentVersions.publishedAt,
      version: documentVersions.version,
    })
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.tenantId, tenantId),
        inArray(documentVersions.documentId, documentIds),
        isNotNull(documentVersions.publishedAt),
      ),
    )
    .orderBy(asc(documentVersions.version))
  for (const row of published) {
    const header = result.get(row.documentId)
    if (header && !header.issuedAt) header.issuedAt = row.publishedAt!.toISOString()
    const document = metadataById.get(row.documentId)
    if (header && document) {
      if (!document.headerRevisedOn) header.revisedAt = row.publishedAt!.toISOString()
      if (
        !document.headerVersionLabel &&
        (document.status === 'published' || document.status === 'archived')
      )
        header.version = row.version
    }
  }
  const reviews = await tx
    .select({
      documentId: documentManagementReviewDocuments.documentId,
      participants: documentManagementReviews.participants,
    })
    .from(documentManagementReviewDocuments)
    .innerJoin(
      documentManagementReviews,
      and(
        eq(documentManagementReviews.tenantId, documentManagementReviewDocuments.tenantId),
        eq(documentManagementReviews.id, documentManagementReviewDocuments.managementReviewId),
      ),
    )
    .where(
      and(
        eq(documentManagementReviewDocuments.tenantId, tenantId),
        inArray(documentManagementReviewDocuments.documentId, documentIds),
      ),
    )
    .orderBy(desc(documentManagementReviews.periodEnd))
  const participantIds = [...new Set(reviews.flatMap((row) => row.participants ?? []))]
  const members =
    participantIds.length === 0
      ? []
      : await tx
          .select({
            id: tenantUsers.id,
            displayName: tenantUsers.displayName,
            name: users.name,
            email: users.email,
          })
          .from(tenantUsers)
          .leftJoin(users, eq(users.id, tenantUsers.userId))
          .where(and(eq(tenantUsers.tenantId, tenantId), inArray(tenantUsers.id, participantIds)))
  const names = new Map(
    members.map((row) => [
      row.id,
      row.displayName?.trim() || row.name?.trim() || row.email?.trim(),
    ]),
  )
  const seen = new Set<string>()
  for (const row of reviews) {
    if (seen.has(row.documentId)) continue
    seen.add(row.documentId)
    const header = result.get(row.documentId)
    if (header && !header.approvedBy)
      header.approvedBy =
        (row.participants ?? [])
          .map((id) => names.get(id))
          .filter(Boolean)
          .join('; ') || null
  }
  return result
}
