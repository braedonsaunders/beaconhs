// WOPI GetFile / PutFile — Collabora Online streams an office master out of
// storage on session open (GET) and writes the edited file back on every save
// (POST, X-WOPI-Override: PUT). A successful save bumps the attachment and
// audits the edit against the owning entity; training decks additionally
// re-queue the slide render so the learner-facing deck catches up (documents
// need no derived render — Writer is the draft view, PDFs snapshot at publish).

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { attachments, documents, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { deleteObject, getObjectStream, newAttachmentKey, putObject } from '@beaconhs/storage'
import { enqueueSlidesRender } from '@beaconhs/jobs'
import { audit } from '@beaconhs/audit'
import { verifyWopiToken, type WopiGrant } from '@/lib/wopi'
import { wopiGrantCanAccessFile, wopiPrincipalIsAuthorized } from '@/lib/wopi-access'
import {
  readBoundedRequestBody,
  RequestBodyLengthError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'
import { tenantIsActive } from '@/lib/active-tenant'

export const dynamic = 'force-dynamic'

// Match the document uploader's production ceiling. The streaming reader
// enforces this before retaining more than the configured number of bytes.
const MAX_OFFICE_BYTES = 500 * 1024 * 1024
const MAX_OFFICE_UPLOAD_MS = 10 * 60 * 1_000

class WopiSaveConflict extends Error {
  override readonly name = 'WopiSaveConflict'
}

async function cleanupObject(key: string, reason: string): Promise<void> {
  try {
    await deleteObject({ key })
  } catch (error) {
    console.error(`[wopi] failed to delete ${reason} object ${key}`, error)
  }
}

function authenticate(req: NextRequest, fileId: string): WopiGrant | null {
  const token = req.nextUrl.searchParams.get('access_token') ?? ''
  return verifyWopiToken(token, fileId)
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params
  const grant = authenticate(req, fileId)
  if (!grant) return new NextResponse('Invalid or expired WOPI token', { status: 401 })
  if (!(await tenantIsActive(grant.tenantId))) {
    return new NextResponse('Workspace unavailable', { status: 403 })
  }
  if (!(await wopiPrincipalIsAuthorized(grant))) {
    return new NextResponse('WOPI access has been revoked', { status: 403 })
  }

  const att = await withTenant(db, grant.tenantId, async (tx) => {
    if (!(await wopiGrantCanAccessFile(tx, grant))) return null
    const [row] = await tx
      .select({ key: attachments.r2Key, contentType: attachments.contentType })
      .from(attachments)
      .where(eq(attachments.id, fileId))
      .limit(1)
    return row ?? null
  })
  if (!att) return new NextResponse('File not found', { status: 404 })

  const obj = await getObjectStream({ key: att.key })
  return new NextResponse(obj.stream, {
    headers: {
      'Content-Type': obj.contentType ?? att.contentType ?? 'application/octet-stream',
      ...(obj.contentLength ? { 'Content-Length': String(obj.contentLength) } : {}),
    },
  })
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params
  const grant = authenticate(req, fileId)
  if (!grant) return new NextResponse('Invalid or expired WOPI token', { status: 401 })
  if (!(await tenantIsActive(grant.tenantId))) {
    return new NextResponse('Workspace unavailable', { status: 403 })
  }
  if (!(await wopiPrincipalIsAuthorized(grant))) {
    return new NextResponse('WOPI access has been revoked', { status: 403 })
  }
  if (!grant.canWrite) return new NextResponse('Read-only token', { status: 403 })

  const override = req.headers.get('x-wopi-override')
  if (override && override !== 'PUT') {
    // Locks are declared unsupported in CheckFileInfo; PutRelativeFile is
    // disabled via UserCanNotWriteRelative.
    return new NextResponse(`Unsupported WOPI operation: ${override}`, { status: 501 })
  }

  const att = await withTenant(db, grant.tenantId, async (tx) => {
    if (!(await wopiGrantCanAccessFile(tx, grant))) return null
    const [row] = await tx
      .select({
        key: attachments.r2Key,
        contentType: attachments.contentType,
        filename: attachments.filename,
        updatedAt: attachments.updatedAt,
      })
      .from(attachments)
      .where(eq(attachments.id, fileId))
      .limit(1)
    return row ?? null
  })
  if (!att) return new NextResponse('File not found', { status: 404 })

  // WOPI conflict detection: Collabora echoes the LastModifiedTime it loaded;
  // if the file changed underneath the session (e.g. re-imported), refuse the
  // save so the user can reload instead of silently clobbering.
  const clientStamp = req.headers.get('x-lool-wopi-timestamp')
  const currentStamp = (att.updatedAt ?? new Date(0)).toISOString()
  if (clientStamp && clientStamp !== currentStamp) {
    return NextResponse.json({ LOOLStatusCode: 1010 }, { status: 409 })
  }

  let body: Buffer
  try {
    body = await readBoundedRequestBody(req, {
      maxBytes: MAX_OFFICE_BYTES,
      timeoutMs: MAX_OFFICE_UPLOAD_MS,
    })
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new NextResponse('File too large', { status: 413 })
    }
    if (error instanceof RequestBodyLengthError) {
      return new NextResponse('Invalid Content-Length', { status: 400 })
    }
    if (error instanceof RequestBodyTimeoutError) {
      return new NextResponse('Upload timed out', { status: 408 })
    }
    throw error
  }
  if (body.length === 0) return new NextResponse('Empty file body', { status: 400 })
  // Large uploads can take long enough for a platform administrator to suspend
  // the workspace after the initial token check. Re-check immediately before
  // the irreversible object-store write.
  if (!(await tenantIsActive(grant.tenantId))) {
    return new NextResponse('Workspace unavailable', { status: 403 })
  }
  if (!(await wopiPrincipalIsAuthorized(grant))) {
    return new NextResponse('WOPI access has been revoked', { status: 403 })
  }
  const targetStillCurrent = await withTenant(db, grant.tenantId, (tx) =>
    wopiGrantCanAccessFile(tx, grant),
  )
  if (!targetStillCurrent) {
    return new NextResponse('Editor source changed; reload the document', { status: 409 })
  }

  // Stage under a new immutable key. Only the following DB transaction can
  // publish that key; a stale editor can therefore never overwrite the object
  // still referenced by the current attachment row.
  const stagedKey = newAttachmentKey({
    tenantId: grant.tenantId,
    kind: 'document',
    filename: att.filename,
  })
  await putObject({
    key: stagedKey,
    body,
    contentType: att.contentType || 'application/octet-stream',
  })

  // Uploading a large file can outlast a membership or permission change.
  // Re-check after staging; the new key is still unreferenced and safe to
  // delete if access was revoked while bytes were in flight.
  if (!(await tenantIsActive(grant.tenantId))) {
    await cleanupObject(stagedKey, 'revoked staged')
    return new NextResponse('Workspace unavailable', { status: 403 })
  }
  if (!(await wopiPrincipalIsAuthorized(grant))) {
    await cleanupObject(stagedKey, 'revoked staged')
    return new NextResponse('WOPI access has been revoked', { status: 403 })
  }

  const savedAt = new Date()
  try {
    await withTenant(db, grant.tenantId, async (tx) => {
      if (grant.target === 'document') {
        const [target] = await tx
          .update(documents)
          .set({ updatedAt: savedAt })
          .where(
            and(
              eq(documents.id, grant.targetId),
              eq(documents.sourceAttachmentId, fileId),
              isNull(documents.deletedAt),
            ),
          )
          .returning({ id: documents.id })
        if (!target) throw new WopiSaveConflict('Document source changed')
      } else {
        const table = grant.target === 'lesson' ? trainingLessons : trainingContentItems
        const [target] = await tx
          .update(table)
          .set({ importStatus: 'pending', importError: null })
          .where(
            and(
              eq(table.id, grant.targetId),
              eq(table.sourceAttachmentId, fileId),
              isNull(table.deletedAt),
            ),
          )
          .returning({ id: table.id })
        if (!target) throw new WopiSaveConflict('Deck source changed')
      }

      const [attachment] = await tx
        .update(attachments)
        .set({ r2Key: stagedKey, sizeBytes: body.length, updatedAt: savedAt })
        .where(
          and(
            eq(attachments.id, fileId),
            eq(attachments.r2Key, att.key),
            eq(attachments.updatedAt, att.updatedAt),
          ),
        )
        .returning({ id: attachments.id })
      if (!attachment) throw new WopiSaveConflict('Attachment was saved concurrently')

      await audit(tx, {
        tenantId: grant.tenantId,
        actorUserId: grant.userId,
        entityType:
          grant.target === 'document'
            ? 'document'
            : grant.target === 'lesson'
              ? 'training_lesson'
              : 'training_content_item',
        entityId: grant.targetId,
        action: 'update',
        summary:
          grant.target === 'document'
            ? `Saved "${att.filename}" in the editor`
            : `Saved PowerPoint "${att.filename}" in the editor`,
        metadata: { attachmentId: fileId, sizeBytes: body.length },
      })
    })
  } catch (error) {
    await cleanupObject(stagedKey, 'uncommitted staged')
    if (error instanceof WopiSaveConflict) {
      return new NextResponse('Editor source changed; reload the file', { status: 409 })
    }
    throw error
  }

  // The DB now points exclusively at stagedKey. Failure to remove the old
  // object must not turn a committed save into a false failure; log it with the
  // exact key so operators can retry cleanup without risking live data.
  await cleanupObject(att.key, 'superseded')

  if (grant.target !== 'document') {
    try {
      await enqueueSlidesRender({
        kind: 'slides_import',
        tenantId: grant.tenantId,
        target: grant.target,
        targetId: grant.targetId,
        attachmentId: fileId,
      })
    } catch (error) {
      // The immutable file + DB commit succeeded. Returning a failure would
      // make Collabora retry a save that is already canonical; the pending
      // import status and this exact log keep the render failure observable.
      console.error(
        `[wopi] saved ${grant.target} ${grant.targetId}, but could not enqueue slide rendering`,
        error,
      )
    }
  }

  return NextResponse.json({ LastModifiedTime: savedAt.toISOString() })
}
