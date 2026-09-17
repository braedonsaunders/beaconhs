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

import { and, eq, ne } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { attachments, documents, documentVersions } from '@beaconhs/db/schema'
import {
  deleteObject,
  getObject,
  newAttachmentKey,
  newTenantObjectKey,
  putObject,
} from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import { sofficeConvert } from '@beaconhs/office'
import { setDocxPageSize } from '@beaconhs/office/docx-page-size'

const MAX_TEXT_CHARS = 1_500_000
const MAX_OFFICE_INPUT_BYTES = 100 * 1024 * 1024
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function renderErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : 'Document render failed')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .slice(0, 4_000)
}

function assertOfficeInput(
  attachment: {
    sizeBytes: number
    contentType: string
  },
  bytes?: Buffer,
): void {
  if (attachment.contentType !== DOCX_MIME) {
    throw new Error('Document render source is not a Word document')
  }
  if (attachment.sizeBytes <= 0 || attachment.sizeBytes > MAX_OFFICE_INPUT_BYTES) {
    throw new Error('Document render source exceeds the 100 MB conversion limit')
  }
  if (bytes && bytes.length !== attachment.sizeBytes) {
    throw new Error('Document render source size does not match its attachment record')
  }
}

/**
 * The paper every document is authored and printed on.
 *
 * Not configurable: a book composed from mixed paper has to scale the odd sizes
 * to fit, which shrinks their type and widens their margins against everything
 * else. The blank master new documents start from is already Letter; this is
 * what stops an imported or uploaded master reintroducing the mismatch.
 */
const DOCUMENT_PAGE_SIZE = 'letter'

/**
 * Convert a master to PDF, forcing the house paper size first.
 *
 * `setDocxPageSize` hands back the original bytes when the master is already
 * Letter, so this costs nothing for documents authored in the app.
 */
async function renderDocxToPdf(docx: Buffer): Promise<Buffer> {
  return sofficeConvert(await setDocxPageSize(docx, DOCUMENT_PAGE_SIZE), 'document.docx', 'pdf')
}

export async function renderDocumentVersion(args: {
  tenantId: string
  documentId: string
  versionId: string
}): Promise<void> {
  const { tenantId, documentId, versionId } = args

  const setStatus = (status: 'processing' | 'failed', error: string | null = null) =>
    withTenant(db, tenantId, async (tx) => {
      await tx
        .update(documentVersions)
        .set({ renderStatus: status, renderError: error })
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, documentId),
            ne(documentVersions.renderStatus, 'complete'),
          ),
        )
    })

  let uploadedKey: string | null = null
  try {
    const data = await withTenant(db, tenantId, async (tx) => {
      const [version] = await tx
        .select({
          version: documentVersions.version,
          docxAttachmentId: documentVersions.docxAttachmentId,
          pdfAttachmentId: documentVersions.pdfAttachmentId,
          renderStatus: documentVersions.renderStatus,
        })
        .from(documentVersions)
        .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)))
        .limit(1)
      if (!version?.docxAttachmentId) return null
      const [doc] = await tx
        .select({ key: documents.key, title: documents.title })
        .from(documents)
        .where(eq(documents.id, documentId))
        .limit(1)
      if (!doc) return null
      const [att] = await tx
        .select({
          key: attachments.r2Key,
          sizeBytes: attachments.sizeBytes,
          contentType: attachments.contentType,
        })
        .from(attachments)
        .where(eq(attachments.id, version.docxAttachmentId))
        .limit(1)
      if (!att) return null
      return { versionNumber: version.version, version, doc, source: att }
    })
    if (!data) throw new Error('Version snapshot or its DOCX file not found')
    if (data.version.renderStatus === 'complete' && data.version.pdfAttachmentId) return

    assertOfficeInput(data.source)
    await setStatus('processing')

    const docx = await getObject({ key: data.source.key })
    assertOfficeInput(data.source, docx)
    const pdf = await renderDocxToPdf(docx)
    const text = (await sofficeConvert(docx, 'document.docx', 'txt:Text'))
      .toString('utf8')
      .slice(0, MAX_TEXT_CHARS)

    const baseName =
      (data.doc.key || data.doc.title || 'document')
        .replace(/[^\w.\- ]+/g, '')
        .trim()
        .slice(0, 180) || 'document'
    const filename = `${baseName}-v${data.versionNumber}.pdf`
    const key = newAttachmentKey({ tenantId, kind: 'document', filename })
    await putObject({
      key,
      body: pdf,
      contentType: 'application/pdf',
      contentDisposition: 'inline',
    })
    uploadedKey = key

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
      const [updated] = await tx
        .update(documentVersions)
        .set({
          pdfAttachmentId: pdfAtt.id,
          textContent: text,
          renderStatus: 'complete',
          renderError: null,
        })
        .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)))
        .returning({ id: documentVersions.id })
      if (!updated) throw new Error('Document version was removed before render completion')
      await audit(tx, {
        tenantId,
        entityType: 'document',
        entityId: documentId,
        action: 'update',
        summary: `Rendered PDF for version ${data.versionNumber}`,
        metadata: { versionId, pdfAttachmentId: pdfAtt.id, sizeBytes: pdf.length },
      })
    })
    uploadedKey = null
    console.log(`[document-render] version ${versionId} rendered (${pdf.length} bytes)`)
  } catch (err) {
    if (uploadedKey) {
      await deleteObject({ key: uploadedKey }).catch(() => undefined)
    }
    const message = renderErrorMessage(err)
    console.error(`[document-render] version ${versionId} failed:`, message)
    await setStatus('failed', message).catch(() => {})
    throw err
  }
}

/**
 * On-demand PDF of the CURRENT working master — the manager's Write→PDF
 * preview. Returns a transient artifact (never attached to the document);
 * published versions keep their own immutable PDFs.
 */
export async function renderDocumentMasterPdf(args: {
  tenantId: string
  documentId: string
}): Promise<{ attachmentId?: string | null; r2Key: string; sizeBytes: number; filename: string }> {
  const { tenantId, documentId } = args
  const data = await withTenant(db, tenantId, async (tx) => {
    const [doc] = await tx
      .select({
        key: documents.key,
        title: documents.title,
        sourceAttachmentId: documents.sourceAttachmentId,
      })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1)
    if (!doc?.sourceAttachmentId) return null
    const [att] = await tx
      .select({
        key: attachments.r2Key,
        sizeBytes: attachments.sizeBytes,
        contentType: attachments.contentType,
      })
      .from(attachments)
      .where(eq(attachments.id, doc.sourceAttachmentId))
      .limit(1)
    return att ? { doc, source: att } : null
  })
  if (!data) throw new Error('This document has no Word file to render')

  assertOfficeInput(data.source)
  const docx = await getObject({ key: data.source.key })
  assertOfficeInput(data.source, docx)
  const pdf = await renderDocxToPdf(docx)

  const stamp = Date.now()
  const base =
    (data.doc.key || data.doc.title || 'document')
      .replace(/[^\w.\- ]+/g, '')
      .trim()
      .slice(0, 180) || 'document'
  const key = newTenantObjectKey({
    tenantId,
    scope: '_transient/pdfs/documents',
    filename: `${documentId}-draft-${stamp}.pdf`,
  })
  await putObject({
    key,
    body: pdf,
    contentType: 'application/pdf',
    contentDisposition: 'inline',
    lifecycle: 'transient',
  })
  console.log(`[document-render] draft pdf ${documentId} rendered (${pdf.length} bytes)`)
  return { r2Key: key, sizeBytes: pdf.length, filename: `${base}-draft.pdf` }
}
