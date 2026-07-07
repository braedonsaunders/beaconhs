// WOPI GetFile / PutFile — Collabora Online streams the pptx master out of
// storage on session open (GET) and writes the edited file back on every save
// (POST, X-WOPI-Override: PUT). A successful save bumps the attachment,
// re-queues the slide render so the learner-facing deck catches up, and audits
// the edit against the owning lesson / library item.

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { attachments, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { getObjectStream, putObject } from '@beaconhs/storage'
import { enqueueSlidesRender } from '@beaconhs/jobs'
import { audit } from '@beaconhs/audit'
import { verifyWopiToken, type WopiGrant } from '@/lib/wopi'

export const dynamic = 'force-dynamic'

// Generous ceiling for large field decks (the user-facing upload cap is lower);
// protects the host from a runaway body, not a policy limit.
const MAX_PPTX_BYTES = 1024 * 1024 * 1024

function authenticate(req: NextRequest, fileId: string): WopiGrant | null {
  const token = req.nextUrl.searchParams.get('access_token') ?? ''
  return verifyWopiToken(token, fileId)
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params
  const grant = authenticate(req, fileId)
  if (!grant) return new NextResponse('Invalid or expired WOPI token', { status: 401 })

  const att = await withTenant(db, grant.tenantId, async (tx) => {
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
  if (!grant.canWrite) return new NextResponse('Read-only token', { status: 403 })

  const override = req.headers.get('x-wopi-override')
  if (override && override !== 'PUT') {
    // Locks are declared unsupported in CheckFileInfo; PutRelativeFile is
    // disabled via UserCanNotWriteRelative.
    return new NextResponse(`Unsupported WOPI operation: ${override}`, { status: 501 })
  }

  const att = await withTenant(db, grant.tenantId, async (tx) => {
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

  const body = Buffer.from(await req.arrayBuffer())
  if (body.length === 0) return new NextResponse('Empty file body', { status: 400 })
  if (body.length > MAX_PPTX_BYTES) return new NextResponse('File too large', { status: 413 })

  // Overwrite the master in place (S3 PUT is atomic), then bump the version
  // stamp and kick a re-render for the deck that owns this master.
  await putObject({
    key: att.key,
    body,
    contentType:
      att.contentType ||
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })

  const savedAt = new Date()
  const table = grant.target === 'lesson' ? trainingLessons : trainingContentItems
  const entityType = grant.target === 'lesson' ? 'training_lesson' : 'training_content_item'

  const stillMastered = await withTenant(db, grant.tenantId, async (tx) => {
    await tx
      .update(attachments)
      .set({ sizeBytes: body.length, updatedAt: savedAt })
      .where(eq(attachments.id, fileId))

    const [target] = await tx
      .select({ sourceAttachmentId: table.sourceAttachmentId })
      .from(table)
      .where(eq(table.id, grant.targetId))
      .limit(1)
    const mastered = target?.sourceAttachmentId === fileId
    if (mastered) {
      await tx
        .update(table)
        .set({ importStatus: 'pending', importError: null })
        .where(eq(table.id, grant.targetId))
    }
    await audit(tx, {
      tenantId: grant.tenantId,
      actorUserId: grant.userId,
      entityType,
      entityId: grant.targetId,
      action: 'update',
      summary: `Saved PowerPoint "${att.filename}" in the editor`,
      metadata: { attachmentId: fileId, sizeBytes: body.length },
    })
    return mastered
  })

  // Deck detached mid-session: the file is saved, but there is no derived
  // render to refresh anymore.
  if (stillMastered) {
    await enqueueSlidesRender({
      kind: 'slides_import',
      tenantId: grant.tenantId,
      target: grant.target,
      targetId: grant.targetId,
      attachmentId: fileId,
    })
  }

  return NextResponse.json({ LastModifiedTime: savedAt.toISOString() })
}
