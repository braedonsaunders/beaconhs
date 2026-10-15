'use server'

// Document PDF-source actions (the Overview metadata autosaves through the
// `documents` record saver in ../_record-edits.ts). Authoring lives in Collabora Writer
// (see _master-actions.ts): getDocumentPdfUrl resolves what the PDF pane shows
// — a fresh render of the working master for managers (draft mode), the
// published version's PDF for readers, or the uploaded file for file-only
// documents.

import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm'
import { attachments, documentVersions, documents } from '@beaconhs/db/schema'
import { presignExistingGet } from '@beaconhs/storage'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { nextDocumentMajorVersion } from '@/lib/document-authoring-policy'
import {
  assertUploadedDocumentPdf,
  documentVersionVisibilityWhere,
} from '@/lib/document-version-policy'
import { requireRecordInput, requireUuidInput } from '@/lib/mutation-input'

type DocumentPdfUrlResult =
  | { ok: true; url: string }
  // reason 'no_source' = the document simply has no PDF yet (nothing uploaded,
  // nothing published) — the pane shows the centered upload state for it.
  | { ok: false; error: string; reason?: 'no_source' }

// Returns a short-lived URL to view the document inline. Prefers an uploaded
// PDF version; otherwise points the viewer at the dynamic PDF route, which
// renders the document on demand.
export async function getDocumentPdfUrl(
  documentId: string,
  opts: { draft?: boolean } = {},
): Promise<DocumentPdfUrlResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.read')
  if (!documentId) return { ok: false, error: 'Missing document id' }
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }
  const canManage = ctx.isSuperAdmin || can(ctx, 'documents.manage')

  // Managers previewing an authored document get a FRESH render of the
  // current working master (the /pdf route dispatches the worker job).
  if (opts.draft) {
    if (!canManage) return { ok: false, error: 'Not allowed' }
    const [doc] = await ctx.db((tx) =>
      tx
        .select({ sourceAttachmentId: documents.sourceAttachmentId })
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .limit(1),
    )
    if (!doc) return { ok: false, error: 'Document not found.' }
    if (!doc.sourceAttachmentId) {
      return { ok: false, error: 'This document has no Word file to render.' }
    }
    return { ok: true, url: `/documents/${documentId}/pdf?render=${Date.now()}` }
  }

  // Readers may only view published documents — the same rule the list and
  // detail pages apply. Managers can preview any live document.
  const [doc] = await ctx.db((tx) =>
    tx
      .select({ status: documents.status })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1),
  )
  if (!doc) return { ok: false, error: 'Document not found.' }
  if (doc.status !== 'published' && !canManage) {
    return { ok: false, error: 'This document is not published.' }
  }

  // Resolve one version first. Managers may preview a replacement; readers
  // stay on the last published version until the manager presses Publish.
  // Selecting the version once also prevents an old uploaded PDF from
  // shadowing a newer authored version.
  const [version] = await ctx.db((tx) =>
    tx
      .select({
        contentAttachmentId: documentVersions.contentAttachmentId,
        pdfAttachmentId: documentVersions.pdfAttachmentId,
        renderStatus: documentVersions.renderStatus,
        renderError: documentVersions.renderError,
      })
      .from(documentVersions)
      .where(documentVersionVisibilityWhere(documentId, canManage))
      .orderBy(desc(documentVersions.version))
      .limit(1),
  )
  if (!version) {
    return {
      ok: false,
      error: canManage
        ? 'This document has no file version yet.'
        : 'This document has no published version yet.',
      reason: 'no_source',
    }
  }

  if (version.contentAttachmentId) {
    const [uploaded] = await ctx.db((tx) =>
      tx
        .select({ key: attachments.r2Key, contentType: attachments.contentType })
        .from(attachments)
        .where(eq(attachments.id, version.contentAttachmentId!))
        .limit(1),
    )
    if (!uploaded || uploaded.contentType !== 'application/pdf') {
      return { ok: false, error: 'The uploaded PDF version is invalid or missing.' }
    }
    const url = await presignExistingGet({ key: uploaded.key, expiresInSeconds: 300 })
    if (!url) return { ok: false, error: 'Uploaded PDF is missing from storage.' }
    return { ok: true, url }
  }

  // Authored document — the selected version's worker-rendered PDF.
  if (!version.pdfAttachmentId) {
    if (version.renderStatus === 'failed') {
      return { ok: false, error: version.renderError || 'The PDF render failed.' }
    }
    if (version.renderStatus === 'pending' || version.renderStatus === 'processing') {
      return { ok: false, error: 'The PDF is being prepared — try again in a moment.' }
    }
    return { ok: false, error: 'This version has no PDF file.' }
  }
  const pdfAttachmentId = version.pdfAttachmentId
  const [pdfAtt] = await ctx.db((tx) =>
    tx
      .select({ key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, pdfAttachmentId))
      .limit(1),
  )
  if (!pdfAtt) return { ok: false, error: 'The rendered PDF is missing from storage.' }
  const url = await presignExistingGet({ key: pdfAtt.key, expiresInSeconds: 300 })
  if (!url) return { ok: false, error: 'The rendered PDF is missing from storage.' }
  return { ok: true, url }
}

// Attach an uploaded PDF as a new unpublished file version. The document row
// is the version-allocation mutex, and a replay with the same attachment is
// idempotent.
export async function attachFileVersion(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  try {
    const values = requireRecordInput(input, 'Uploaded document')
    const documentId = requireUuidInput(values.documentId, 'Document')
    const attachmentId = requireUuidInput(values.attachmentId, 'PDF')
    await ctx.db(async (tx) => {
      const [doc] = await tx
        .select({ id: documents.id, sourceAttachmentId: documents.sourceAttachmentId })
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .limit(1)
        .for('update')
      if (!doc) throw new Error('Document not found.')
      if (doc.sourceAttachmentId) {
        throw new Error('Authored documents publish from their Word working file.')
      }

      const [attachment] = await tx
        .select({ kind: attachments.kind, contentType: attachments.contentType })
        .from(attachments)
        .where(eq(attachments.id, attachmentId))
        .limit(1)
      if (!attachment) throw new Error('Uploaded PDF not found.')
      assertUploadedDocumentPdf(attachment)

      const [existingUse] = await tx
        .select({ documentId: documentVersions.documentId })
        .from(documentVersions)
        .where(eq(documentVersions.contentAttachmentId, attachmentId))
        .limit(1)
      if (existingUse) {
        if (existingUse.documentId === documentId) return
        throw new Error('This uploaded PDF already belongs to another document.')
      }

      const [authoredVersion] = await tx
        .select({ id: documentVersions.id })
        .from(documentVersions)
        .where(
          and(
            eq(documentVersions.documentId, documentId),
            isNotNull(documentVersions.docxAttachmentId),
          ),
        )
        .limit(1)
      if (authoredVersion) {
        throw new Error('Authored documents cannot also use uploaded-PDF versions.')
      }

      const [latest] = await tx
        .select({ version: documentVersions.version })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId))
        .orderBy(desc(documentVersions.version))
        .limit(1)
      const next = nextDocumentMajorVersion(latest?.version)
      const [created] = await tx
        .insert(documentVersions)
        .values({
          tenantId: ctx.tenantId,
          documentId,
          version: next,
          contentAttachmentId: attachmentId,
        })
        .returning({ id: documentVersions.id })
      if (!created) throw new Error('The PDF version could not be created.')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'document',
        entityId: documentId,
        action: 'update',
        summary: 'Uploaded a draft PDF version',
        after: { versionId: created.id, version: next, attachmentId },
      })
    })
    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The PDF could not be attached.',
    }
  }
}
