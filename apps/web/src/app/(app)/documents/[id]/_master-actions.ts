'use server'

// DOCX-master actions for authored documents. Collabora Writer is THE editor:
// the master file is the working draft (autosaved by the editor through the
// WOPI host — page setup, comments and track changes live in the file), and
// publishing snapshots it into an immutable, numbered document_versions row
// whose PDF + text the worker renders for readers.

import { revalidatePath } from 'next/cache'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { attachments, documents, documentVersions } from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { getObject, newAttachmentKey, putObject } from '@beaconhs/storage'
import { sofficeConvert } from '@beaconhs/office'
import { enqueueDocumentVersionRender } from '@beaconhs/jobs'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { buildEditorUrl, getCollaboraEditUrl } from '@/lib/collabora'
import { mintWopiToken } from '@/lib/wopi'
import { blankDocxBuffer } from '@/lib/docx-blank'
import type { CollaboraSession } from '@/components/collabora-embed'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/**
 * Mint a Writer session. Without `versionId` this opens the live master
 * (writable, documents.manage). With `versionId` it opens that immutable
 * published snapshot read-only (documents.read) — version history viewing.
 */
export async function getDocumentWriterSession(
  documentId: string,
  versionId?: string,
): Promise<CollaboraSession> {
  const ctx = await requireRequestContext()
  assertCan(ctx, versionId ? 'documents.read' : 'documents.manage')

  const attachmentId = await ctx.db(async (tx) => {
    if (versionId) {
      const [v] = await tx
        .select({
          docxAttachmentId: documentVersions.docxAttachmentId,
          publishedAt: documentVersions.publishedAt,
        })
        .from(documentVersions)
        .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId)))
        .limit(1)
      // Readers only ever see published snapshots.
      if (!v?.publishedAt && !can(ctx, 'documents.manage')) return null
      return v?.docxAttachmentId ?? null
    }
    const [doc] = await tx
      .select({ sourceAttachmentId: documents.sourceAttachmentId })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1)
    return doc?.sourceAttachmentId ?? null
  })
  if (!attachmentId) return { ok: false, error: 'no_master' }

  const editUrl = await getCollaboraEditUrl('text')
  if (!editUrl) return { ok: false, error: 'not_configured' }

  const { token, exp } = mintWopiToken({
    attachmentId,
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    userName: ctx.membership?.displayName ?? 'BeaconHS user',
    target: 'document',
    targetId: documentId,
    canWrite: !versionId,
  })
  return {
    ok: true,
    actionUrl: buildEditorUrl(editUrl, attachmentId),
    accessToken: token,
    accessTokenTtl: exp,
  }
}

/** Start a new document: create a blank .docx master. */
export async function createBlankDocumentMaster(documentId: string) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId

  const docx = blankDocxBuffer()
  await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({ title: documents.title, key: documents.key })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc) throw new Error('Document not found')

    const filename = `${(doc.key || doc.title || 'Document').replace(/[^\w.\- ]+/g, '').trim() || 'Document'}.docx`
    const key = newAttachmentKey({ tenantId, kind: 'document', filename })
    await putObject({ key, body: docx, contentType: DOCX_MIME })
    const [att] = await tx
      .insert(attachments)
      .values({
        tenantId,
        uploadedBy: ctx.userId,
        kind: 'document',
        r2Key: key,
        contentType: DOCX_MIME,
        sizeBytes: docx.length,
        filename,
      })
      .returning()
    if (!att) throw new Error('Failed to create the document file')
    await tx
      .update(documents)
      .set({ sourceAttachmentId: att.id })
      .where(eq(documents.id, documentId))
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'update',
    summary: 'Started a new Word document',
  })
  revalidatePath(`/documents/${documentId}`)
}

/** Import / replace the working master with an uploaded .docx. */
export async function importDocumentMaster(documentId: string, attachmentId: string) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')

  await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc) throw new Error('Document not found')
    const [att] = await tx
      .select({ id: attachments.id })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1)
    if (!att) throw new Error('Uploaded file not found')
    await tx
      .update(documents)
      .set({ sourceAttachmentId: attachmentId })
      .where(eq(documents.id, documentId))
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'update',
    summary: 'Imported a Word file as the working document',
    after: { attachmentId },
  })
  revalidatePath(`/documents/${documentId}`)
}

/**
 * Publish: snapshot the DOCX master into an immutable numbered version and
 * queue its PDF/text render. The master keeps living as the next draft.
 */
export async function publishDocumentVersion(documentId: string, changelog?: string) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')
  if (!ctx.tenantId) throw new Error('No active tenant')
  const tenantId = ctx.tenantId

  const master = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({
        title: documents.title,
        key: documents.key,
        sourceAttachmentId: documents.sourceAttachmentId,
      })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc?.sourceAttachmentId) throw new Error('This document has no Word file to publish')
    const [att] = await tx
      .select({ key: attachments.r2Key, filename: attachments.filename })
      .from(attachments)
      .where(eq(attachments.id, doc.sourceAttachmentId))
      .limit(1)
    if (!att) throw new Error('The working document file is missing')
    return { doc, att }
  })

  // Immutable snapshot: copy the master's bytes to a fresh object so later
  // edits can never rewrite a published version.
  const bytes = await getObject({ key: master.att.key })
  const versionId = await ctx.db(async (tx) => {
    const [latest] = await tx
      .select({ version: documentVersions.version })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.version))
      .limit(1)
    const nextVersion = (latest?.version ?? 0) + 1

    const base = (master.doc.key || master.doc.title || 'document').replace(/[^\w.\- ]+/g, '')
    const filename = `${base}-v${nextVersion}.docx`
    const key = newAttachmentKey({ tenantId, kind: 'document', filename })
    await putObject({ key, body: bytes, contentType: DOCX_MIME })
    const [snapshot] = await tx
      .insert(attachments)
      .values({
        tenantId,
        uploadedBy: ctx.userId,
        kind: 'document',
        r2Key: key,
        contentType: DOCX_MIME,
        sizeBytes: bytes.length,
        filename,
      })
      .returning()
    if (!snapshot) throw new Error('Failed to snapshot the document file')

    const [version] = await tx
      .insert(documentVersions)
      .values({
        tenantId,
        documentId,
        version: nextVersion,
        docxAttachmentId: snapshot.id,
        renderStatus: 'pending',
        publishedAt: new Date(),
        publishedBy: ctx.userId,
        changelog: changelog?.trim() || null,
      })
      .returning()
    if (!version) throw new Error('Failed to create the version')

    await tx.update(documents).set({ status: 'published' }).where(eq(documents.id, documentId))
    return version.id
  })

  await enqueueDocumentVersionRender({
    kind: 'document_version_render',
    tenantId,
    documentId,
    versionId,
  })
  await recordAudit(ctx, {
    entityType: 'document',
    entityId: documentId,
    action: 'publish',
    summary: 'Published a new version',
    metadata: { versionId, changelog: changelog?.trim() || null },
  })
  revalidatePath(`/documents/${documentId}`)
}

/**
 * Plain text of the CURRENT working master (LibreOffice extraction) — grounds
 * the document AI panel in what the author is actually editing, not just the
 * last published version.
 */
export async function getDocumentDraftText(
  documentId: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')

  const att = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({ sourceAttachmentId: documents.sourceAttachmentId })
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc?.sourceAttachmentId) return null
    const [row] = await tx
      .select({ key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, doc.sourceAttachmentId))
      .limit(1)
    return row ?? null
  })
  if (!att) return { ok: false, error: 'This document has no Word file yet.' }

  try {
    const docx = await getObject({ key: att.key })
    const text = (await sofficeConvert(docx, 'document.docx', 'txt:Text')).toString('utf8')
    return { ok: true, text: text.slice(0, 24_000) }
  } catch {
    return { ok: false, error: 'Could not read the document text.' }
  }
}
