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

import { and, eq, isNull, ne, or } from 'drizzle-orm'
import { db, withTenant, loadDocumentControlHeaders } from '@beaconhs/db'
import { attachments, documents, documentVersions, tenants } from '@beaconhs/db/schema'
import {
  deleteObject,
  getObject,
  newAttachmentKey,
  newTenantObjectKey,
  putObject,
} from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import { sofficeConvert } from '@beaconhs/office'
import { composeControlledDocumentPdf, renderDocxToPdf } from '../lib/document-pdf'

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
        .set({ renderStatus: status, renderError: error, updatedAt: new Date() })
        .where(
          and(
            eq(documentVersions.id, versionId),
            eq(documentVersions.documentId, documentId),
            or(
              ne(documentVersions.renderStatus, 'complete'),
              isNull(documentVersions.pdfAttachmentId),
              isNull(documentVersions.bodyPdfAttachmentId),
              isNull(documentVersions.bookPdfAttachmentId),
            ),
          ),
        )
    })

  const uploadedKeys: string[] = []
  try {
    const data = await withTenant(db, tenantId, async (tx) => {
      const [version] = await tx
        .select({
          version: documentVersions.version,
          controlHeader: documentVersions.controlHeader,
          docxAttachmentId: documentVersions.docxAttachmentId,
          pdfAttachmentId: documentVersions.pdfAttachmentId,
          bodyPdfAttachmentId: documentVersions.bodyPdfAttachmentId,
          bookPdfAttachmentId: documentVersions.bookPdfAttachmentId,
          renderStatus: documentVersions.renderStatus,
        })
        .from(documentVersions)
        .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)))
        .limit(1)
      if (!version?.docxAttachmentId) return null
      const [doc] = await tx
        .select({
          key: documents.key,
          title: documents.title,
          branding: tenants.branding,
          tenantName: tenants.name,
        })
        .from(documents)
        .innerJoin(tenants, eq(tenants.id, documents.tenantId))
        .where(and(eq(documents.id, documentId), eq(tenants.id, tenantId)))
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
      const header =
        version.controlHeader ??
        (await loadDocumentControlHeaders(tx, tenantId, [documentId])).get(documentId)
      if (!header) throw new Error('Document header details are unavailable')
      return { versionNumber: version.version, version, doc, source: att, header }
    })
    if (!data) throw new Error('Version snapshot or its DOCX file not found')
    if (
      data.version.renderStatus === 'complete' &&
      data.version.pdfAttachmentId &&
      data.version.bodyPdfAttachmentId &&
      data.version.bookPdfAttachmentId
    )
      return

    assertOfficeInput(data.source)
    await setStatus('processing')

    const docx = await getObject({ key: data.source.key })
    assertOfficeInput(data.source, docx)
    const bodyPdf = await renderDocxToPdf(docx)
    const bookPdf = await renderDocxToPdf(docx, { reserveHeader: true })
    const pdf = await composeControlledDocumentPdf(bookPdf, data.header, {
      tenantName: data.doc.tenantName,
      accentColor: data.doc.branding.primaryColor,
      headerReserved: true,
    })
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
    uploadedKeys.push(key)
    const layouts = [
      { name: 'book', bytes: bookPdf },
      { name: 'body', bytes: bodyPdf },
    ]
    const layoutFiles: { name: string; key: string; filename: string; sizeBytes: number }[] = []
    for (const layout of layouts) {
      const layoutFilename = `${baseName}-v${data.versionNumber}-${layout.name}.pdf`
      const layoutKey = newAttachmentKey({ tenantId, kind: 'document', filename: layoutFilename })
      await putObject({
        key: layoutKey,
        body: layout.bytes,
        contentType: 'application/pdf',
        contentDisposition: 'inline',
      })
      uploadedKeys.push(layoutKey)
      layoutFiles.push({
        name: layout.name,
        key: layoutKey,
        filename: layoutFilename,
        sizeBytes: layout.bytes.length,
      })
    }

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
      const layoutIds = new Map<string, string>()
      for (const file of layoutFiles) {
        const [attachment] = await tx
          .insert(attachments)
          .values({
            tenantId,
            kind: 'document',
            r2Key: file.key,
            filename: file.filename,
            sizeBytes: file.sizeBytes,
            contentType: 'application/pdf',
          })
          .returning({ id: attachments.id })
        if (!attachment) throw new Error('Failed to store the document body layout')
        layoutIds.set(file.name, attachment.id)
      }
      const [updated] = await tx
        .update(documentVersions)
        .set({
          pdfAttachmentId: pdfAtt.id,
          bodyPdfAttachmentId: layoutIds.get('body') ?? pdfAtt.id,
          bookPdfAttachmentId: layoutIds.get('book'),
          textContent: text,
          renderStatus: 'complete',
          renderError: null,
          updatedAt: new Date(),
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
    uploadedKeys.length = 0
    console.log(`[document-render] version ${versionId} rendered (${pdf.length} bytes)`)
  } catch (err) {
    await Promise.all(uploadedKeys.map((key) => deleteObject({ key }).catch(() => undefined)))
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
        tenantName: tenants.name,
        branding: tenants.branding,
      })
      .from(documents)
      .innerJoin(tenants, eq(tenants.id, documents.tenantId))
      .where(and(eq(documents.id, documentId), eq(tenants.id, tenantId)))
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
    const header = (await loadDocumentControlHeaders(tx, tenantId, [documentId])).get(documentId)
    return att ? { doc, source: att, header } : null
  })
  if (!data) throw new Error('This document has no Word file to render')

  assertOfficeInput(data.source)
  const docx = await getObject({ key: data.source.key })
  assertOfficeInput(data.source, docx)
  if (!data.header) throw new Error('Document header details are unavailable')
  const body = await renderDocxToPdf(docx, { reserveHeader: true })
  const pdf = await composeControlledDocumentPdf(body, data.header, {
    tenantName: data.doc.tenantName,
    accentColor: data.doc.branding.primaryColor,
    headerReserved: true,
  })

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

/** Decorate an exact version on demand; never overwrite its historical source. */
export async function renderDocumentVersionPdf(args: {
  tenantId: string
  documentId: string
  versionId: string
}): Promise<{ r2Key: string; sizeBytes: number; filename: string }> {
  const { tenantId, documentId, versionId } = args
  const data = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        version: documentVersions,
        doc: documents,
        tenantName: tenants.name,
        branding: tenants.branding,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .innerJoin(tenants, eq(tenants.id, documents.tenantId))
      .where(
        and(
          eq(documentVersions.id, versionId),
          eq(documents.id, documentId),
          isNull(documents.deletedAt),
        ),
      )
      .limit(1)
    if (!row) throw new Error('Document version not found')
    const header =
      row.version.controlHeader ??
      (await loadDocumentControlHeaders(tx, tenantId, [documentId])).get(documentId)
    if (!header) throw new Error('Document header details are unavailable')
    // Historical metadata without a frozen header must still identify the selected version.
    if (!row.version.controlHeader) {
      header.version = row.doc.headerVersionLabel || row.version.version
      header.revisedAt = row.doc.headerRevisedOn || row.version.publishedAt?.toISOString() || null
    }
    const attachmentId =
      row.version.bookPdfAttachmentId ??
      row.version.bodyPdfAttachmentId ??
      row.version.contentAttachmentId ??
      row.version.docxAttachmentId ??
      row.version.pdfAttachmentId
    if (!attachmentId) throw new Error('The PDF is still being prepared')
    const [attachment] = await tx
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1)
    if (!attachment || attachment.kind !== 'document') throw new Error('Document source is missing')
    return { ...row, header, attachment, headerReserved: Boolean(row.version.bookPdfAttachmentId) }
  })
  if (data.attachment.sizeBytes <= 0 || data.attachment.sizeBytes > MAX_OFFICE_INPUT_BYTES)
    throw new Error('Document exceeds the 100 MB rendering limit')
  let body = await getObject({ key: data.attachment.r2Key })
  if (body.length !== data.attachment.sizeBytes)
    throw new Error('Document source size does not match its record')
  let headerReserved = data.headerReserved
  if (data.attachment.contentType === DOCX_MIME) {
    body = await renderDocxToPdf(body, { reserveHeader: true })
    headerReserved = true
  } else if (
    data.attachment.contentType !== 'application/pdf' ||
    !body.subarray(0, 5).equals(Buffer.from('%PDF-'))
  )
    throw new Error('Document source is not a valid PDF')
  const pdf = await composeControlledDocumentPdf(body, data.header, {
    tenantName: data.tenantName,
    accentColor: data.branding.primaryColor,
    headerReserved,
  })
  const filename = `${(data.doc.key || 'document').replace(/[^\w.\- ]+/g, '_')}-v${data.version.version}.pdf`
  const r2Key = newTenantObjectKey({
    tenantId,
    scope: '_transient/pdfs/documents',
    filename: `${versionId}-${Date.now()}.pdf`,
  })
  await putObject({
    key: r2Key,
    body: pdf,
    contentType: 'application/pdf',
    contentDisposition: 'inline',
    lifecycle: 'transient',
  })
  return { r2Key, sizeBytes: pdf.length, filename }
}
