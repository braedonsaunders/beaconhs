// WOPI GetFile / PutFile — Collabora Online streams an office master out of
// storage on session open (GET) and writes the edited file back on every save
// (POST, X-WOPI-Override: PUT). A successful save bumps the attachment and
// audits the edit against the owning entity. PPTX masters have no derived
// slide images: editing and playback both read this same canonical file.

import { NextRequest, NextResponse } from 'next/server'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { attachments, documents, trainingContentItems, trainingLessons } from '@beaconhs/db/schema'
import { deleteObject, getObjectStream, newAttachmentKey, putObject } from '@beaconhs/storage'
import { audit } from '@beaconhs/audit'
import {
  DOCX_MIME_TYPE,
  MAX_DOCX_CONVERSION_BYTES,
  MAX_PPTX_FILE_BYTES,
  PPTX_MIME_TYPE,
} from '@beaconhs/office/limits'
import { verifyWopiToken, type WopiGrant } from '@/lib/wopi'
import {
  decideWopiLock,
  decideWopiPut,
  readWopiLockHeader,
  WOPI_LOCK_TTL_MS,
  type WopiLockOverride,
} from '@/lib/wopi-protocol'
import { wopiGrantCanAccessFile, wopiPrincipalIsAuthorized } from '@/lib/wopi-access'
import {
  readBoundedRequestBody,
  RequestBodyLengthError,
  RequestBodyTimeoutError,
  RequestBodyTooLargeError,
} from '@/lib/request-body'
import { tenantIsActive } from '@/lib/active-tenant'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

// Match the web upload/edit contract. The streaming reader
// enforces this before retaining more than the configured number of bytes.
const MAX_OFFICE_UPLOAD_MS = 10 * 60 * 1_000

class WopiSaveConflict extends Error {
  override readonly name = 'WopiSaveConflict'
}

class WopiLockMismatch extends Error {
  override readonly name = 'WopiLockMismatch'
  constructor(readonly currentLock: string) {
    super('WOPI lock mismatch')
  }
}

class WopiTimestampConflict extends Error {
  override readonly name = 'WopiTimestampConflict'
}

function sqlRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[]
  return (result as { rows?: T[] }).rows ?? []
}

function lockResponse(status: number, lock: string): NextResponse {
  return new NextResponse(null, {
    status,
    headers: { 'X-WOPI-Lock': lock },
  })
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
  if (!isUuid(fileId)) return new NextResponse('File not found', { status: 404 })

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

const LOCK_OVERRIDES = new Set<WopiLockOverride>(['LOCK', 'UNLOCK', 'REFRESH_LOCK', 'GET_LOCK'])

function isLockOverride(value: string): value is WopiLockOverride {
  return LOCK_OVERRIDES.has(value as WopiLockOverride)
}

async function fileIsCurrent(grant: WopiGrant): Promise<boolean> {
  return withTenant(db, grant.tenantId, (tx) => wopiGrantCanAccessFile(tx, grant))
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params
  if (!isUuid(fileId)) return new NextResponse('File not found', { status: 404 })

  const grant = authenticate(req, fileId)
  if (!grant) return new NextResponse('Invalid or expired WOPI token', { status: 401 })
  if (!(await tenantIsActive(grant.tenantId))) {
    return new NextResponse('Workspace unavailable', { status: 403 })
  }
  if (!(await wopiPrincipalIsAuthorized(grant))) {
    return new NextResponse('WOPI access has been revoked', { status: 403 })
  }
  if (!grant.canWrite) return new NextResponse('Read-only token', { status: 403 })
  if (!(await fileIsCurrent(grant))) return new NextResponse('File not found', { status: 404 })

  const override = (req.headers.get('x-wopi-override') ?? 'PUT').toUpperCase()
  if (isLockOverride(override)) return handleWopiLock(req, grant, fileId, override)
  if (override !== 'PUT') {
    return new NextResponse(`Unsupported WOPI operation: ${override}`, { status: 501 })
  }

  const att = await withTenant(db, grant.tenantId, async (tx) => {
    if (!(await wopiGrantCanAccessFile(tx, grant))) return null
    const [row] = await tx
      .select({
        contentType: attachments.contentType,
        filename: attachments.filename,
      })
      .from(attachments)
      .where(eq(attachments.id, fileId))
      .limit(1)
    return row ?? null
  })
  if (!att) return new NextResponse('File not found', { status: 404 })

  const maxBytes =
    att.contentType === PPTX_MIME_TYPE
      ? MAX_PPTX_FILE_BYTES
      : att.contentType === DOCX_MIME_TYPE
        ? MAX_DOCX_CONVERSION_BYTES
        : null
  if (maxBytes === null) {
    return new NextResponse('Unsupported office file type', { status: 415 })
  }

  // Ticket is issued before the upload so an autosave that started first cannot
  // commit after the publish save and put the old bytes back.
  const ticket = await issueSaveTicket(grant.tenantId, fileId)
  if (ticket === null) return new NextResponse('File not found', { status: 404 })

  const requestLock = readWopiLockHeader(req.headers.get('x-wopi-lock'))
  if (!requestLock.ok) return new NextResponse('Invalid lock', { status: 400 })
  const clientStamp =
    req.headers.get('x-lool-wopi-timestamp') ?? req.headers.get('x-cool-wopi-timestamp')

  let body: Buffer
  try {
    body = await readBoundedRequestBody(req, {
      maxBytes,
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
  // Re-check after staging; the new key is still unreferenced and safe to delete.
  if (!(await tenantIsActive(grant.tenantId))) {
    await cleanupObject(stagedKey, 'revoked staged')
    return new NextResponse('Workspace unavailable', { status: 403 })
  }
  if (!(await wopiPrincipalIsAuthorized(grant))) {
    await cleanupObject(stagedKey, 'revoked staged')
    return new NextResponse('WOPI access has been revoked', { status: 403 })
  }

  const savedAt = new Date()
  let outcome: { kind: 'applied'; previousKey: string } | { kind: 'superseded'; updatedAt: Date }
  try {
    outcome = await withTenant(db, grant.tenantId, async (tx) => {
      const [row] = await tx
        .select({
          key: attachments.r2Key,
          updatedAt: attachments.updatedAt,
          wopiLock: attachments.wopiLock,
          wopiLockExpiresAt: attachments.wopiLockExpiresAt,
          wopiAppliedTicket: attachments.wopiAppliedTicket,
        })
        .from(attachments)
        .where(eq(attachments.id, fileId))
        .limit(1)
        .for('update')
      if (!row) throw new WopiSaveConflict('Attachment is gone')

      const decision = decideWopiPut({
        clientStamp,
        serverUpdatedAt: row.updatedAt,
        requestLock: requestLock.lock,
        storedLock: row.wopiLock,
        storedLockExpiresAt: row.wopiLockExpiresAt,
        requestTicket: ticket,
        appliedTicket: Number(row.wopiAppliedTicket),
        now: Date.now(),
      })
      if (decision.kind === 'superseded') {
        return { kind: 'superseded' as const, updatedAt: row.updatedAt }
      }
      if (decision.kind === 'lock_mismatch') throw new WopiLockMismatch(decision.currentLock)
      if (decision.kind === 'conflict') throw new WopiTimestampConflict()

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
          .set({ updatedAt: savedAt })
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
        .set({
          r2Key: stagedKey,
          sizeBytes: body.length,
          updatedAt: savedAt,
          wopiAppliedTicket: ticket,
        })
        .where(eq(attachments.id, fileId))
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
      return { kind: 'applied' as const, previousKey: row.key }
    })
  } catch (error) {
    await cleanupObject(stagedKey, 'uncommitted staged')
    if (error instanceof WopiLockMismatch) return lockResponse(409, error.currentLock)
    if (error instanceof WopiTimestampConflict) {
      return NextResponse.json({ LOOLStatusCode: 1010, COOLStatusCode: 1010 }, { status: 409 })
    }
    if (error instanceof WopiSaveConflict) {
      return new NextResponse('Editor source changed; reload the file', { status: 409 })
    }
    throw error
  }

  if (outcome.kind === 'superseded') {
    await cleanupObject(stagedKey, 'superseded staged')
    return NextResponse.json({ LastModifiedTime: outcome.updatedAt.toISOString() })
  }

  // The DB now points exclusively at stagedKey. Failure to remove the old
  // object must not turn a committed save into a false failure; log it with the
  // exact key so operators can retry cleanup without risking live data.
  if (outcome.previousKey !== stagedKey) await cleanupObject(outcome.previousKey, 'superseded')

  return NextResponse.json({ LastModifiedTime: savedAt.toISOString() })
}

async function issueSaveTicket(tenantId: string, fileId: string): Promise<number | null> {
  return withTenant(db, tenantId, async (tx) => {
    const result = await tx.execute(sql`
      update attachments
      set wopi_save_ticket = wopi_save_ticket + 1
      where id = ${fileId}
      returning wopi_save_ticket
    `)
    const row = sqlRows<{ wopi_save_ticket: string | number }>(result)[0]
    if (!row) return null
    const ticket = Number(row.wopi_save_ticket)
    return Number.isSafeInteger(ticket) ? ticket : null
  })
}

async function handleWopiLock(
  req: NextRequest,
  grant: WopiGrant,
  fileId: string,
  override: WopiLockOverride,
): Promise<NextResponse> {
  const requestLock = readWopiLockHeader(req.headers.get('x-wopi-lock'))
  const oldLock = readWopiLockHeader(req.headers.get('x-wopi-oldlock'))
  if (!requestLock.ok || !oldLock.ok) return new NextResponse('Invalid lock', { status: 400 })

  const now = Date.now()
  const decision = await withTenant(db, grant.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        wopiLock: attachments.wopiLock,
        wopiLockExpiresAt: attachments.wopiLockExpiresAt,
      })
      .from(attachments)
      .where(eq(attachments.id, fileId))
      .limit(1)
      .for('update')
    if (!row) return null
    const next = decideWopiLock({
      override,
      requestLock: requestLock.lock,
      oldLock: oldLock.lock,
      storedLock: row.wopiLock,
      storedLockExpiresAt: row.wopiLockExpiresAt,
      now,
    })
    if (next.kind !== 'ok' || override === 'GET_LOCK') return next
    const expiresAt = next.lock ? new Date(now + WOPI_LOCK_TTL_MS) : null
    // Raw SQL: a lock refresh must not bump updated_at.
    await tx.execute(sql`
      update attachments
      set wopi_lock = ${next.lock || null},
          wopi_lock_expires_at = ${expiresAt}
      where id = ${fileId}
    `)
    return next
  })
  if (!decision) return new NextResponse('File not found', { status: 404 })
  if (decision.kind === 'bad_request') return new NextResponse('Invalid lock', { status: 400 })
  if (decision.kind === 'mismatch') return lockResponse(409, decision.currentLock)
  return lockResponse(200, decision.lock)
}
