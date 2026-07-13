'use server'

// Document metadata + PDF-source actions. Authoring lives in Collabora Writer
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
import { recordAudit } from '@/lib/audit'

type SaveDraftResult = { ok: true; updatedAt: string } | { ok: false; error: string }

// ---- Document metadata -----------------------------------------------------

async function renameDocument(input: {
  documentId: string
  title: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  const title = input.title.trim()
  if (!input.documentId) return { ok: false, error: 'Missing document id' }
  if (!title) return { ok: false, error: 'Title is required' }
  await ctx.db((tx) =>
    tx.update(documents).set({ title }).where(eq(documents.id, input.documentId)),
  )
  revalidatePath(`/documents/${input.documentId}`)
  return { ok: true }
}

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

  // Managers previewing an authored document get a FRESH render of the
  // current working master (the /pdf route dispatches the worker job).
  if (opts.draft) {
    if (!can(ctx, 'documents.manage')) return { ok: false, error: 'Not allowed' }
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
  if (doc.status !== 'published' && !can(ctx, 'documents.manage')) {
    return { ok: false, error: 'This document is not published.' }
  }

  // 1. Uploaded-PDF document — the latest version that points at a PDF
  //    attachment (published or not, so a just-uploaded source shows at once).
  const [uploaded] = await ctx.db((tx) =>
    tx
      .select({ key: attachments.r2Key, contentType: attachments.contentType })
      .from(documentVersions)
      .innerJoin(attachments, eq(attachments.id, documentVersions.contentAttachmentId))
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.version))
      .limit(1),
  )
  if (uploaded?.contentType === 'application/pdf') {
    const url = await presignExistingGet({ key: uploaded.key, expiresInSeconds: 300 })
    if (!url) return { ok: false, error: 'Uploaded PDF is missing from storage.' }
    return { ok: true, url }
  }

  // 2. Authored document — the latest published version's rendered PDF (the
  //    worker snapshots it from the DOCX master at publish time).
  const [published] = await ctx.db((tx) =>
    tx
      .select({
        renderStatus: documentVersions.renderStatus,
        renderError: documentVersions.renderError,
        pdfAttachmentId: documentVersions.pdfAttachmentId,
      })
      .from(documentVersions)
      .where(
        and(eq(documentVersions.documentId, documentId), isNotNull(documentVersions.publishedAt)),
      )
      .orderBy(desc(documentVersions.version))
      .limit(1),
  )
  if (!published) {
    return {
      ok: false,
      error: 'This document has no published version yet.',
      reason: 'no_source',
    }
  }
  if (!published.pdfAttachmentId) {
    if (published.renderStatus === 'failed') {
      return { ok: false, error: published.renderError || 'The PDF render failed.' }
    }
    if (published.renderStatus === 'pending' || published.renderStatus === 'processing') {
      return { ok: false, error: 'The PDF is being prepared — try again in a moment.' }
    }
    return { ok: false, error: 'This version has no PDF file.' }
  }
  const [pdfAtt] = await ctx.db((tx) =>
    tx
      .select({ key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, published.pdfAttachmentId!))
      .limit(1),
  )
  if (!pdfAtt) return { ok: false, error: 'The rendered PDF is missing from storage.' }
  const url = await presignExistingGet({ key: pdfAtt.key, expiresInSeconds: 300 })
  if (!url) return { ok: false, error: 'The rendered PDF is missing from storage.' }
  return { ok: true, url }
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

// Edit all document "header" metadata from the manage page (incl. first-time fill-in).
export async function updateDocumentMeta(input: {
  documentId: string
  title?: string
  key?: string
  categoryId?: string | null
  typeId?: string | null
  description?: string | null
  reviewFrequencyMonths?: number | null
  nextReviewOn?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!input.documentId) return { ok: false, error: 'Missing document id' }
  const patch: Record<string, unknown> = {}
  if (input.title !== undefined) {
    const t = input.title.trim()
    if (!t) return { ok: false, error: 'Title is required' }
    patch.title = t
  }
  if (input.key !== undefined) {
    const k = slugify(input.key)
    if (k) patch.key = k
  }
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId || null
  if (input.typeId !== undefined) patch.typeId = input.typeId || null
  if (input.description !== undefined) patch.description = input.description?.trim() || null
  if (input.reviewFrequencyMonths !== undefined)
    patch.reviewFrequencyMonths = input.reviewFrequencyMonths
  if (input.nextReviewOn !== undefined) patch.nextReviewOn = input.nextReviewOn || null
  if (Object.keys(patch).length === 0) return { ok: true }
  await ctx.db((tx) => tx.update(documents).set(patch).where(eq(documents.id, input.documentId)))
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: input.documentId,
    action: 'update',
    summary: 'Updated document details',
  })
  revalidatePath(`/documents/${input.documentId}`)
  revalidatePath('/documents')
  return { ok: true }
}

// Attach an uploaded file (e.g. a PDF) as a new file version of the document.
export async function attachFileVersion(input: {
  documentId: string
  attachmentId: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!input.documentId || !input.attachmentId) return { ok: false, error: 'Missing fields' }
  await ctx.db(async (tx) => {
    const [latest] = await tx
      .select({ version: documentVersions.version })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, input.documentId))
      .orderBy(desc(documentVersions.version))
      .limit(1)
    const next = (latest?.version ?? 0) + 1
    await tx.insert(documentVersions).values({
      tenantId: ctx.tenantId,
      documentId: input.documentId,
      version: next,
      contentAttachmentId: input.attachmentId,
    })
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: input.documentId,
    action: 'update',
    summary: 'Attached a file version',
  })
  revalidatePath(`/documents/${input.documentId}`)
  return { ok: true }
}

// ---- Comments --------------------------------------------------------------

type DocumentCommentRow = {
  id: string
  anchorId: string | null
  quotedText: string | null
  body: string
  threadId: string | null
  resolvedAt: string | null
  createdAt: string
  authorTenantUserId: string
  authorName: string
}
