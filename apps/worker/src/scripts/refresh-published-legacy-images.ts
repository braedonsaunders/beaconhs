// One-off: show the restored legacy images in the CURRENT published versions.
//
// embed-legacy-azure-images.ts embedded the old Beacon's Azure-linked images
// into each affected working DOCX master. The published versions of those
// documents were snapshotted after the images had already been lost, so
// readers still see no pictures. Publishing a new version would ask everyone
// to acknowledge again for a change that adds pictures only.
//
//   pnpm --filter @beaconhs/worker exec tsx src/scripts/refresh-published-legacy-images.ts [--apply]
//
// Scope: documents whose working master was repaired by the embed script (its
// audit entries). For each, when the working master and the current published
// version have the SAME reader-visible wording, the published version's DOCX
// snapshot is replaced in place by the master (same version, same key, bumped
// attachment stamp) and re-rendered. Acknowledgements stay attached to that
// version. A document whose master holds unpublished wording changes is left
// alone and reported, because swapping it in would publish those edits.
//
// Without --apply it changes nothing. Idempotent: a refreshed version's
// snapshot is byte-identical to its master and is skipped.

import { and, desc, eq, isNotNull, isNull, like } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { attachments, auditLog, documents, documentVersions } from '@beaconhs/db/schema'
import { getObject, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import { docxWording } from '@beaconhs/office/docx-text'
import { renderDocumentVersion } from '../workers/document-render'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

async function repairedDocumentIds(): Promise<string[]> {
  const rows = await withSuperAdmin(db, (tx) =>
    tx
      .selectDistinct({ entityId: auditLog.entityId })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, 'document'),
          like(auditLog.summary, 'Embedded % legacy linked image(s) into % (working master)'),
        ),
      ),
  )
  return rows.flatMap((row) => (row.entityId ? [row.entityId] : []))
}

async function attachmentKey(id: string) {
  const [row] = await withSuperAdmin(db, (tx) =>
    tx
      .select({ id: attachments.id, r2Key: attachments.r2Key, sizeBytes: attachments.sizeBytes })
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1),
  )
  return row ?? null
}

async function main() {
  const apply = process.argv.includes('--apply')
  const ids = await repairedDocumentIds()
  console.log(`${ids.length} document(s) had legacy images restored in their working master`)

  let refreshed = 0
  let unchanged = 0
  let skipped = 0
  let failed = 0

  for (const documentId of ids) {
    let label = documentId
    try {
      const [doc] = await withSuperAdmin(db, (tx) =>
        tx
          .select({
            tenantId: documents.tenantId,
            title: documents.title,
            key: documents.key,
            sourceAttachmentId: documents.sourceAttachmentId,
          })
          .from(documents)
          .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
          .limit(1),
      )
      if (!doc?.sourceAttachmentId) continue
      label = doc.key || doc.title

      const [version] = await withSuperAdmin(db, (tx) =>
        tx
          .select({
            id: documentVersions.id,
            version: documentVersions.version,
            docxAttachmentId: documentVersions.docxAttachmentId,
          })
          .from(documentVersions)
          .where(
            and(
              eq(documentVersions.documentId, documentId),
              isNotNull(documentVersions.publishedAt),
            ),
          )
          .orderBy(desc(documentVersions.version))
          .limit(1),
      )
      if (!version?.docxAttachmentId) {
        console.log(`  skip ${label}: no published version`)
        skipped++
        continue
      }

      const master = await attachmentKey(doc.sourceAttachmentId)
      const snapshot = await attachmentKey(version.docxAttachmentId)
      if (!master || !snapshot) throw new Error('missing attachment record')

      const masterBytes = await getObject({ key: master.r2Key })
      const snapshotBytes = await getObject({ key: snapshot.r2Key })
      if (masterBytes.equals(snapshotBytes)) {
        unchanged++
        continue
      }

      const [masterWording, publishedWording] = await Promise.all([
        docxWording(masterBytes),
        docxWording(snapshotBytes),
      ])
      if (masterWording !== publishedWording) {
        console.log(
          `  skip ${label} v${version.version}: the working master has unpublished wording changes`,
        )
        skipped++
        continue
      }

      if (!apply) {
        console.log(`  would refresh ${label} v${version.version} with its restored images`)
        refreshed++
        continue
      }

      await putObject({ key: snapshot.r2Key, body: masterBytes, contentType: DOCX_MIME })
      await withTenant(db, doc.tenantId, async (tx) => {
        await tx
          .update(attachments)
          .set({ sizeBytes: masterBytes.length, updatedAt: new Date() })
          .where(eq(attachments.id, snapshot.id))
        await tx
          .update(documentVersions)
          .set({ renderStatus: 'pending', renderError: null })
          .where(eq(documentVersions.id, version.id))
        await audit(tx, {
          tenantId: doc.tenantId,
          entityType: 'document',
          entityId: documentId,
          action: 'update',
          summary: `Restored legacy images in published version ${version.version} (wording unchanged; acknowledgements kept)`,
          metadata: { versionId: version.id, attachmentId: snapshot.id },
        })
      })
      await renderDocumentVersion({ tenantId: doc.tenantId, documentId, versionId: version.id })
      console.log(`  refreshed ${label} v${version.version}`)
      refreshed++
    } catch (error) {
      failed++
      console.error(`  FAILED ${label}: ${(error as Error).message}`)
    }
  }

  console.log(
    `\n${apply ? 'refreshed' : 'would refresh'} ${refreshed}; already current ${unchanged}; skipped ${skipped}; failures ${failed}`,
  )
  if (!apply) console.log('Re-run with --apply to write the changes.')
  process.exit(failed > 0 ? 1 : 0)
}

void main()
