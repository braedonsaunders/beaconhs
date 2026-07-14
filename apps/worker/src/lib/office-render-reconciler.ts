import { and, asc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { documentVersions } from '@beaconhs/db/schema'
import { enqueueDocumentVersionRender } from '@beaconhs/jobs'

const RECONCILE_LIMIT = 100
const ENQUEUE_CONCURRENCY = 10

type OfficeRenderReconcileResult = {
  candidates: number
  enqueued: number
  errors: number
}

/**
 * Recover the commit-to-queue gap for document versions, plus a worker process
 * that died after marking a render as processing. PowerPoint decks are played
 * directly from their PPTX masters and have no render job to reconcile.
 */
export async function reconcileOfficeRenders(): Promise<OfficeRenderReconcileResult> {
  const candidates = await withSuperAdmin(db, async (tx) => {
    const documentCandidates = await tx
      .select({
        type: sql<'document'>`'document'`,
        tenantId: documentVersions.tenantId,
        documentId: documentVersions.documentId,
        versionId: documentVersions.id,
        updatedAt: documentVersions.updatedAt,
      })
      .from(documentVersions)
      .where(
        and(
          isNotNull(documentVersions.docxAttachmentId),
          isNull(documentVersions.pdfAttachmentId),
          or(
            and(
              eq(documentVersions.renderStatus, 'pending'),
              sql`${documentVersions.updatedAt} <= now() - interval '2 minutes'`,
            ),
            and(
              eq(documentVersions.renderStatus, 'processing'),
              sql`${documentVersions.updatedAt} <= now() - interval '15 minutes'`,
            ),
          ),
        ),
      )
      .orderBy(asc(documentVersions.updatedAt), asc(documentVersions.id))
      .limit(RECONCILE_LIMIT)

    return documentCandidates
  })

  const result: OfficeRenderReconcileResult = {
    candidates: candidates.length,
    enqueued: 0,
    errors: 0,
  }
  for (let index = 0; index < candidates.length; index += ENQUEUE_CONCURRENCY) {
    const batch = candidates.slice(index, index + ENQUEUE_CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map((candidate) =>
        enqueueDocumentVersionRender({
          kind: 'document_version_render',
          tenantId: candidate.tenantId,
          documentId: candidate.documentId,
          versionId: candidate.versionId,
        }),
      ),
    )
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') result.enqueued += 1
      else result.errors += 1
    }
  }
  return result
}
