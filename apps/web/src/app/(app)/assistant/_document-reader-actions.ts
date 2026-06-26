'use server'

// Loads a controlled document's FULL content for the in-chat reader panel.
// Permission is enforced identically to the assistant's read_document tool: the
// user must hold documents.read (or manage), and non-managers see published docs
// only (documentReadFilter). Unlike the tool — which truncates to plain text for
// the model's context — this returns the complete content for a human to read:
// the sanitized HTML for in-app documents, or a short-lived presigned URL for an
// uploaded PDF version (whose HTML body is empty), so the reader can show even a
// scanned/image-only PDF that has no extractable text.

import { and, desc, eq, isNull, type SQL } from 'drizzle-orm'
import { attachments, documentDrafts, documentVersions, documents } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import { presignExistingGet } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { documentReadFilter } from '@/lib/assistant/doc-access'

export type ReaderDocument = {
  id: string
  key: string
  title: string
  status: string
  category: string | null
  updatedAt: string | null
  /** Sanitized HTML body. Empty string when the document has no HTML content
   *  (e.g. an uploaded-PDF version — see `pdfUrl`). */
  html: string
  /** Short-lived presigned URL to the uploaded PDF when the latest version is a
   *  PDF file; null for in-app HTML documents. The reader renders it in an
   *  <iframe> (browsers display PDFs natively). */
  pdfUrl: string | null
}

export type ReaderResult = { ok: true; doc: ReaderDocument } | { ok: false; error: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function getReaderDocument(id: string): Promise<ReaderResult> {
  if (!UUID.test(id)) return { ok: false, error: 'not_found' }
  const ctx = await requireRequestContext()
  if (!can(ctx, 'documents.read') && !can(ctx, 'documents.manage')) {
    return { ok: false, error: 'forbidden' }
  }
  return ctx.db(async (tx) => {
    const conds: SQL[] = [eq(documents.id, id), isNull(documents.deletedAt)]
    const filter = documentReadFilter(ctx)
    if (filter) conds.push(filter)
    const [doc] = await tx
      .select({
        id: documents.id,
        key: documents.key,
        title: documents.title,
        status: documents.status,
        category: documents.category,
        updatedAt: documents.updatedAt,
      })
      .from(documents)
      .where(and(...conds))
      .limit(1)
    if (!doc) return { ok: false, error: 'not_found' }

    // The latest version either carries inline HTML (in-app documents) or points
    // at an uploaded file via contentAttachmentId (e.g. a PDF).
    const [version] = await tx
      .select({
        html: documentVersions.contentMarkdown,
        attachmentId: documentVersions.contentAttachmentId,
      })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, id))
      .orderBy(desc(documentVersions.version))
      .limit(1)

    // Uploaded-PDF version → hand the reader a short-lived presigned URL so it
    // can show the real pages in an <iframe>. Mirrors getDocumentPdfUrl on the
    // documents detail page. (This is what lets a human read a scanned PDF.)
    let pdfUrl: string | null = null
    if (version?.attachmentId) {
      const [att] = await tx
        .select({ r2Key: attachments.r2Key, contentType: attachments.contentType })
        .from(attachments)
        .where(eq(attachments.id, version.attachmentId))
        .limit(1)
      if (att?.contentType === 'application/pdf') {
        pdfUrl = await presignExistingGet({ key: att.r2Key, expiresInSeconds: 300 })
      }
    }

    // In-app documents: prefer the latest published HTML, fall back to the draft.
    let html = pdfUrl ? null : (version?.html ?? null)
    if (!pdfUrl && !html) {
      const [draft] = await tx
        .select({ html: documentDrafts.contentHtml })
        .from(documentDrafts)
        .where(eq(documentDrafts.documentId, id))
        .limit(1)
      html = draft?.html ?? null
    }

    return {
      ok: true,
      doc: {
        id: doc.id,
        key: doc.key,
        title: doc.title,
        status: doc.status,
        category: doc.category,
        updatedAt: doc.updatedAt ? doc.updatedAt.toISOString() : null,
        // Defense-in-depth: content is sanitized on write, sanitized again here.
        html: html ? sanitizeDocumentHtml(html) : '',
        pdfUrl,
      },
    }
  })
}
