// Document version rendering. Publishing a document snapshots its DOCX master
// into an immutable document_versions row; this worker turns that snapshot
// into the artifacts readers consume:
//
//   docx ─(soffice --headless)→ version PDF (what the read/acknowledge view
//   shows — identical pagination on every device) + extracted plain text
//   (search / AI assistant).
//
// Render state is tracked on the version row (renderStatus/renderError) so the
// read view can show a preparing state instead of a broken viewer.

import { eq } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { attachments, documents, documentVersions } from '@beaconhs/db/schema'
import { getObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import { sofficeConvert } from '../lib/office'

const MAX_TEXT_CHARS = 1_500_000

export async function renderDocumentVersion(args: {
  tenantId: string
  documentId: string
  versionId: string
}): Promise<void> {
  const { tenantId, documentId, versionId } = args

  const setStatus = (status: string, error: string | null = null) =>
    withTenant(db, tenantId, async (tx) => {
      await tx
        .update(documentVersions)
        .set({ renderStatus: status, renderError: error })
        .where(eq(documentVersions.id, versionId))
    })

  await setStatus('processing')

  try {
    const data = await withTenant(db, tenantId, async (tx) => {
      const [version] = await tx
        .select({
          version: documentVersions.version,
          docxAttachmentId: documentVersions.docxAttachmentId,
        })
        .from(documentVersions)
        .where(eq(documentVersions.id, versionId))
        .limit(1)
      if (!version?.docxAttachmentId) return null
      const [doc] = await tx
        .select({ key: documents.key, title: documents.title })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1)
      const [att] = await tx
        .select({ key: attachments.r2Key })
        .from(attachments)
        .where(eq(attachments.id, version.docxAttachmentId))
        .limit(1)
      if (!att) return null
      return { versionNumber: version.version, doc, docxKey: att.key }
    })
    if (!data) throw new Error('Version snapshot or its DOCX file not found')

    const docx = await getObject({ key: data.docxKey })
    const pdf = await sofficeConvert(docx, 'document.docx', 'pdf')
    const text = (await sofficeConvert(docx, 'document.docx', 'txt:Text'))
      .toString('utf8')
      .slice(0, MAX_TEXT_CHARS)

    const baseName = (data.doc?.key || data.doc?.title || 'document').replace(/[^\w.\- ]+/g, '')
    const filename = `${baseName}-v${data.versionNumber}.pdf`
    const key = newAttachmentKey({ tenantId, kind: 'document', filename })
    await putObject({ key, body: pdf, contentType: 'application/pdf' })

    await withTenant(db, tenantId, async (tx) => {
      const [pdfAtt] = await tx
        .insert(attachments)
        .values({
          tenantId,
          kind: 'document',
          r2Key: key,
          contentType: 'application/pdf',
          sizeBytes: pdf.length,
          filename,
        })
        .returning()
      if (!pdfAtt) throw new Error('Failed to store the rendered PDF')
      await tx
        .update(documentVersions)
        .set({
          pdfAttachmentId: pdfAtt.id,
          textContent: text,
          renderStatus: 'complete',
          renderError: null,
        })
        .where(eq(documentVersions.id, versionId))
      await audit(tx, {
        tenantId,
        entityType: 'document',
        entityId: documentId,
        action: 'update',
        summary: `Rendered PDF for version ${data.versionNumber}`,
        metadata: { versionId, pdfAttachmentId: pdfAtt.id, sizeBytes: pdf.length },
      })
    })
    console.log(`[document-render] version ${versionId} rendered (${pdf.length} bytes)`)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Document render failed'
    console.error(`[document-render] version ${versionId} failed:`, message)
    await setStatus('failed', message).catch(() => {})
    throw err
  }
}
