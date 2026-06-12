'use server'

// Editor server actions for the world-class document editor:
//   • saveDraft       — debounced autosave of the live working draft
//   • publishDraft    — snapshot the draft into an immutable version (+ legacy fallback)
//   • comments CRUD   — threaded, anchor-bound margin comments
//   • listDocumentComments — re-fetch threads after a mutation
//
// The live draft (document_drafts, 1:1) holds ProseMirror JSON + sanitized HTML.
// Publishing freezes a document_versions row and re-seeds the draft so editing
// continues toward the next version (never a blank page).

import { revalidatePath } from 'next/cache'
import { asc, desc, eq, or, sql } from 'drizzle-orm'
import {
  attachments,
  documentComments,
  documentDrafts,
  documentVersions,
  documents,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import mammoth from 'mammoth'
import { sanitizeDocumentHtml } from '@beaconhs/forms-core'
import {
  getObject,
  newAttachmentKey,
  presignExistingGet,
  publicUrl,
  putObject,
} from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'

export type SaveDraftResult = { ok: true; updatedAt: string } | { ok: false; error: string }

// ---- Document metadata -----------------------------------------------------

export async function renameDocument(input: {
  documentId: string
  title: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  const title = input.title.trim()
  if (!input.documentId) return { ok: false, error: 'Missing document id' }
  if (!title) return { ok: false, error: 'Title is required' }
  await ctx.db((tx) =>
    tx.update(documents).set({ title }).where(eq(documents.id, input.documentId)),
  )
  revalidatePath(`/documents/${input.documentId}`)
  return { ok: true }
}

export async function updateDocumentLayout(input: {
  documentId: string
  pageSize?: 'Letter' | 'A4'
  headerText?: string | null
  footerText?: string | null
  printHeader?: boolean
  printFooter?: boolean
}): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  if (!input.documentId) return { ok: false }
  const patch: Record<string, unknown> = {}
  if (input.pageSize) patch.pageSize = input.pageSize
  if (input.headerText !== undefined) patch.headerText = input.headerText?.trim() || null
  if (input.footerText !== undefined) patch.footerText = input.footerText?.trim() || null
  if (input.printHeader !== undefined) patch.printHeader = input.printHeader
  if (input.printFooter !== undefined) patch.printFooter = input.printFooter
  if (Object.keys(patch).length === 0) return { ok: true }
  await ctx.db((tx) => tx.update(documents).set(patch).where(eq(documents.id, input.documentId)))
  revalidatePath(`/documents/${input.documentId}`)
  return { ok: true }
}

export type DocumentPdfUrlResult = { ok: true; url: string } | { ok: false; error: string }

// Returns a short-lived URL to view the document inline. Prefers an uploaded
// PDF version; otherwise points the viewer at the dynamic PDF route, which
// renders the document on demand.
export async function getDocumentPdfUrl(documentId: string): Promise<DocumentPdfUrlResult> {
  const ctx = await requireRequestContext()
  if (!documentId) return { ok: false, error: 'Missing document id' }
  if (!ctx.tenantId) return { ok: false, error: 'No active tenant' }

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

  return { ok: true, url: `/documents/${documentId}/pdf?render=${Date.now()}` }
}

// Resolves a public URL for an uploaded image attachment (for in-editor embeds
// + PDF rendering). Matches the publicUrl pattern used by the email composer.
export async function getImageUrl(
  attachmentId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  if (!attachmentId) return { ok: false, error: 'Missing attachment id' }
  const [row] = await ctx.db((tx) =>
    tx
      .select({ key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1),
  )
  if (!row) return { ok: false, error: 'Attachment not found' }
  return { ok: true, url: publicUrl(row.key) }
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
  printHeader?: boolean
  printFooter?: boolean
  pageSize?: 'Letter' | 'A4'
  headerText?: string | null
  footerText?: string | null
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
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
  if (input.printHeader !== undefined) patch.printHeader = input.printHeader
  if (input.printFooter !== undefined) patch.printFooter = input.printFooter
  if (input.pageSize !== undefined) patch.pageSize = input.pageSize
  if (input.headerText !== undefined) patch.headerText = input.headerText?.trim() || null
  if (input.footerText !== undefined) patch.footerText = input.footerText?.trim() || null
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

// Convert an uploaded .docx into the document's editable draft (mammoth).
export async function importDocxIntoDocument(input: {
  documentId: string
  attachmentId: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  if (!input.documentId || !input.attachmentId) return { ok: false, error: 'Missing fields' }
  const [att] = await ctx.db((tx) =>
    tx
      .select({
        key: attachments.r2Key,
        contentType: attachments.contentType,
        filename: attachments.filename,
      })
      .from(attachments)
      .where(eq(attachments.id, input.attachmentId))
      .limit(1),
  )
  if (!att) return { ok: false, error: 'File not found' }
  const isDocx =
    att.contentType.includes('wordprocessingml') ||
    (att.filename ?? '').toLowerCase().endsWith('.docx')
  if (!isDocx) return { ok: false, error: 'Please upload a Word (.docx) file' }

  let html = ''
  const imageUploads: { key: string; contentType: string; sizeBytes: number; filename: string }[] =
    []
  try {
    const buffer = await getObject({ key: att.key })
    const result = await mammoth.convertToHtml(
      { buffer },
      {
        convertImage: mammoth.images.imgElement(async (image) => {
          const imgBuf = await image.read()
          const ct = image.contentType || 'image/png'
          const ext = (ct.split('/')[1] || 'png').replace('+xml', '')
          const imgKey = newAttachmentKey({
            tenantId: ctx.tenantId,
            kind: 'image',
            filename: `import.${ext}`,
          })
          await putObject({ key: imgKey, body: imgBuf, contentType: ct })
          imageUploads.push({
            key: imgKey,
            contentType: ct,
            sizeBytes: imgBuf.length,
            filename: `import.${ext}`,
          })
          return { src: publicUrl(imgKey) }
        }),
      },
    )
    html = sanitizeDocumentHtml(result.value)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Conversion failed' }
  }

  await ctx.db(async (tx) => {
    await tx
      .insert(documentDrafts)
      .values({
        tenantId: ctx.tenantId,
        documentId: input.documentId,
        contentHtml: html,
        contentJson: null,
        updatedByTenantUserId: ctx.membership?.id ?? null,
      })
      .onConflictDoUpdate({
        target: documentDrafts.documentId,
        set: {
          contentHtml: html,
          contentJson: null,
          updatedByTenantUserId: ctx.membership?.id ?? null,
          updatedAt: new Date(),
        },
      })
    for (const img of imageUploads) {
      await tx.insert(attachments).values({
        tenantId: ctx.tenantId,
        uploadedBy: ctx.userId,
        kind: 'image',
        r2Key: img.key,
        contentType: img.contentType,
        sizeBytes: img.sizeBytes,
        filename: img.filename,
      })
    }
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: input.documentId,
    action: 'update',
    summary: 'Imported Word document into draft',
  })
  revalidatePath(`/documents/${input.documentId}`)
  return { ok: true }
}

// Attach an uploaded file (e.g. a PDF) as a new file version of the document.
export async function attachFileVersion(input: {
  documentId: string
  attachmentId: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
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

// ---- Autosave --------------------------------------------------------------

export async function saveDraft(input: {
  documentId: string
  contentJson: unknown
  contentHtml: string
}): Promise<SaveDraftResult> {
  const ctx = await requireRequestContext()
  if (!input.documentId) return { ok: false, error: 'Missing document id' }

  const html = sanitizeDocumentHtml(input.contentHtml)
  const json = (input.contentJson ?? null) as Record<string, unknown> | null
  const now = new Date()

  try {
    await ctx.db(async (tx) => {
      await tx
        .insert(documentDrafts)
        .values({
          tenantId: ctx.tenantId,
          documentId: input.documentId,
          contentJson: json,
          contentHtml: html,
          updatedByTenantUserId: ctx.membership?.id ?? null,
        })
        .onConflictDoUpdate({
          target: documentDrafts.documentId,
          set: {
            contentJson: json,
            contentHtml: html,
            updatedByTenantUserId: ctx.membership?.id ?? null,
            updatedAt: now,
          },
        })
    })
    // High-frequency save: deliberately no revalidatePath / no audit per keystroke.
    return { ok: true, updatedAt: now.toISOString() }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Save failed' }
  }
}

// ---- Publish (snapshot) ----------------------------------------------------

export async function publishDraft(input: {
  documentId: string
  changelog?: string | null
}): Promise<{ ok: true; version: number } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const { documentId } = input
  if (!documentId) return { ok: false, error: 'Missing document id' }

  try {
    const version = await ctx.db(async (tx) => {
      const [draft] = await tx
        .select()
        .from(documentDrafts)
        .where(eq(documentDrafts.documentId, documentId))
        .limit(1)

      const [latest] = await tx
        .select({
          id: documentVersions.id,
          version: documentVersions.version,
          publishedAt: documentVersions.publishedAt,
        })
        .from(documentVersions)
        .where(eq(documentVersions.documentId, documentId))
        .orderBy(desc(documentVersions.version))
        .limit(1)

      let publishedVersion: number

      if (draft) {
        // New model: snapshot the live draft into a fresh immutable version.
        const next = (latest?.version ?? 0) + 1
        const [inserted] = await tx
          .insert(documentVersions)
          .values({
            tenantId: ctx.tenantId,
            documentId,
            version: next,
            contentMarkdown: sanitizeDocumentHtml(draft.contentHtml ?? ''),
            contentJson: (draft.contentJson ?? null) as Record<string, unknown> | null,
            publishedAt: new Date(),
            publishedBy: ctx.userId,
            changelog: input.changelog?.trim() || null,
          })
          .returning({ id: documentVersions.id })
        // Re-anchor the draft to the version it now descends from; content carries forward.
        await tx
          .update(documentDrafts)
          .set({ baseVersionId: inserted?.id ?? null })
          .where(eq(documentDrafts.documentId, documentId))
        publishedVersion = next
      } else if (latest) {
        // Legacy / uploaded-file documents have no draft: publish the latest version row.
        if (!latest.publishedAt) {
          await tx
            .update(documentVersions)
            .set({ publishedAt: new Date(), publishedBy: ctx.userId })
            .where(eq(documentVersions.id, latest.id))
        }
        publishedVersion = latest.version
      } else {
        throw new Error('Nothing to publish — the document has no draft or version.')
      }

      await tx.update(documents).set({ status: 'published' }).where(eq(documents.id, documentId))
      return publishedVersion
    })

    await recordAudit(ctx, {
      entityType: 'document',
      entityId: documentId,
      action: 'publish',
      summary: `Published v${version}`,
      after: { version },
    })
    revalidatePath(`/documents/${documentId}`)
    revalidatePath('/documents')
    return { ok: true, version }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Publish failed' }
  }
}

// ---- Comments --------------------------------------------------------------

export type DocumentCommentRow = {
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

export async function listDocumentComments(documentId: string): Promise<DocumentCommentRow[]> {
  const ctx = await requireRequestContext()
  if (!documentId) return []
  const rows = await ctx.db((tx) =>
    tx
      .select({
        c: documentComments,
        memberName: tenantUsers.displayName,
        accountName: user.name,
      })
      .from(documentComments)
      .leftJoin(tenantUsers, eq(tenantUsers.id, documentComments.authorTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(eq(documentComments.documentId, documentId))
      .orderBy(asc(documentComments.createdAt)),
  )
  return rows.map((r) => ({
    id: r.c.id,
    anchorId: r.c.anchorId,
    quotedText: r.c.quotedText,
    body: r.c.body,
    threadId: r.c.threadId,
    resolvedAt: r.c.resolvedAt ? r.c.resolvedAt.toISOString() : null,
    createdAt: r.c.createdAt.toISOString(),
    authorTenantUserId: r.c.authorTenantUserId,
    authorName: r.accountName ?? r.memberName ?? 'User',
  }))
}

export async function addComment(input: {
  documentId: string
  anchorId: string
  quotedText: string | null
  body: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const body = input.body.trim()
  if (!input.documentId || !input.anchorId) return { ok: false, error: 'Missing anchor' }
  if (!body) return { ok: false, error: 'Comment is empty' }
  if (!ctx.membership?.id) return { ok: false, error: 'Membership required to comment' }

  const [row] = await ctx.db((tx) =>
    tx
      .insert(documentComments)
      .values({
        tenantId: ctx.tenantId,
        documentId: input.documentId,
        anchorId: input.anchorId,
        quotedText: input.quotedText?.slice(0, 2000) ?? null,
        body,
        authorTenantUserId: ctx.membership!.id,
        threadId: null,
      })
      .returning({ id: documentComments.id }),
  )
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: input.documentId,
    action: 'create',
    summary: 'Added a comment',
  })
  revalidatePath(`/documents/${input.documentId}/editor`)
  return row ? { ok: true, id: row.id } : { ok: false, error: 'Insert failed' }
}

export async function replyToComment(input: {
  documentId: string
  threadId: string
  body: string
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  const body = input.body.trim()
  if (!input.documentId || !input.threadId) return { ok: false, error: 'Missing thread' }
  if (!body) return { ok: false, error: 'Reply is empty' }
  if (!ctx.membership?.id) return { ok: false, error: 'Membership required to comment' }

  const [row] = await ctx.db((tx) =>
    tx
      .insert(documentComments)
      .values({
        tenantId: ctx.tenantId,
        documentId: input.documentId,
        anchorId: null,
        quotedText: null,
        body,
        authorTenantUserId: ctx.membership!.id,
        threadId: input.threadId,
      })
      .returning({ id: documentComments.id }),
  )
  revalidatePath(`/documents/${input.documentId}/editor`)
  return row ? { ok: true, id: row.id } : { ok: false, error: 'Insert failed' }
}

export async function editComment(input: {
  id: string
  body: string
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  const body = input.body.trim()
  if (!input.id || !body) return { ok: false, error: 'Missing fields' }
  await ctx.db((tx) =>
    tx.update(documentComments).set({ body }).where(eq(documentComments.id, input.id)),
  )
  return { ok: true }
}

export async function resolveComment(input: {
  id: string
  resolved: boolean
}): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  if (!input.id) return { ok: false }
  await ctx.db((tx) =>
    tx
      .update(documentComments)
      .set({
        resolvedAt: input.resolved ? new Date() : null,
        resolvedByTenantUserId: input.resolved ? (ctx.membership?.id ?? null) : null,
      })
      .where(or(eq(documentComments.id, input.id), eq(documentComments.threadId, input.id))),
  )
  return { ok: true }
}

export async function deleteComment(input: { id: string }): Promise<{ ok: boolean }> {
  const ctx = await requireRequestContext()
  if (!input.id) return { ok: false }
  await ctx.db((tx) =>
    // Deleting a root removes its replies too (soft self-reference, no FK cascade).
    tx
      .delete(documentComments)
      .where(or(eq(documentComments.id, input.id), eq(documentComments.threadId, input.id))),
  )
  return { ok: true }
}
