// WOPI CheckFileInfo and lock operations — called server-to-server by
// Collabora Online when an office editing session opens. Public route: authentication is the
// single-file HMAC access_token minted by the editor page (see lib/wopi.ts),
// not a session cookie — Collabora never has one.

import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { attachments } from '@beaconhs/db/schema'
import { verifyWopiToken } from '@/lib/wopi'
import { wopiGrantCanAccessFile, wopiPrincipalIsAuthorized } from '@/lib/wopi-access'
import { tenantIsActive } from '@/lib/active-tenant'
import { isUuid } from '@/lib/list-params'
import {
  decideWopiLock,
  readWopiLockHeader,
  WOPI_LOCK_TTL_MS,
  type WopiLockOverride,
} from '@/lib/wopi-protocol'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params
  if (!isUuid(fileId)) return new NextResponse('File not found', { status: 404 })

  const token = req.nextUrl.searchParams.get('access_token') ?? ''
  const grant = verifyWopiToken(token, fileId)
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
      .select({
        filename: attachments.filename,
        sizeBytes: attachments.sizeBytes,
        updatedAt: attachments.updatedAt,
      })
      .from(attachments)
      .where(eq(attachments.id, fileId))
      .limit(1)
    return row ?? null
  })
  if (!att) return new NextResponse('File not found', { status: 404 })

  // Collabora insists on a recognised extension to pick the right editor
  // (Impress for decks, Writer for documents).
  const fallbackExt = grant.target === 'document' ? 'docx' : 'pptx'
  const baseFileName = /\.(pptx?|docx?)$/i.test(att.filename)
    ? att.filename
    : `${att.filename}.${fallbackExt}`

  return NextResponse.json({
    BaseFileName: baseFileName,
    Size: att.sizeBytes,
    OwnerId: grant.tenantId,
    UserId: grant.userId,
    UserFriendlyName: grant.userName,
    UserCanWrite: grant.canWrite,
    SupportsUpdate: true,
    SupportsLocks: true,
    SupportsGetLock: true,
    // Opaque file version. This is the same instant as LastModifiedTime so a
    // later CheckFileInfo agrees with the PutFile response Collabora stored.
    Version: (att.updatedAt ?? new Date(0)).toISOString(),
    // The pptx is a master copy pinned to one deck — no Save As / rename /
    // export-to-other-locations from inside the editor (Download lives in the
    // BeaconHS UI where it is audited).
    UserCanNotWriteRelative: true,
    UserCanRename: false,
    // Lets the embedding app talk to the editor over postMessage (loading
    // status for the splash, insert-at-cursor for the AI panel).
    PostMessageOrigin: (process.env.APP_URL ?? process.env.BETTER_AUTH_URL ?? '').replace(
      /\/+$/,
      '',
    ),
    LastModifiedTime: (att.updatedAt ?? new Date(0)).toISOString(),
  })
}

// WOPI lock operations target the file endpoint, never /contents (PutFile).
const LOCK_OVERRIDES = new Set<WopiLockOverride>(['LOCK', 'UNLOCK', 'REFRESH_LOCK', 'GET_LOCK'])

export async function POST(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params
  if (!isUuid(fileId)) return new NextResponse('File not found', { status: 404 })
  const grant = verifyWopiToken(req.nextUrl.searchParams.get('access_token') ?? '', fileId)
  if (!grant) return new NextResponse('Invalid or expired WOPI token', { status: 401 })
  if (!(await tenantIsActive(grant.tenantId))) {
    return new NextResponse('Workspace unavailable', { status: 403 })
  }
  if (!(await wopiPrincipalIsAuthorized(grant))) {
    return new NextResponse('WOPI access has been revoked', { status: 403 })
  }
  if (!grant.canWrite) return new NextResponse('Read-only token', { status: 403 })

  const override = (req.headers.get('x-wopi-override') ?? '').toUpperCase()
  if (!LOCK_OVERRIDES.has(override as WopiLockOverride)) {
    return new NextResponse(`Unsupported WOPI operation: ${override}`, { status: 501 })
  }
  const requestLock = readWopiLockHeader(req.headers.get('x-wopi-lock'))
  const oldLock = readWopiLockHeader(req.headers.get('x-wopi-oldlock'))
  if (!requestLock.ok || !oldLock.ok) return new NextResponse('Invalid lock', { status: 400 })

  const now = Date.now()
  const decision = await withTenant(db, grant.tenantId, async (tx) => {
    if (!(await wopiGrantCanAccessFile(tx, grant))) return null
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
      override: override as WopiLockOverride,
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
  return new NextResponse(null, {
    status: decision.kind === 'mismatch' ? 409 : 200,
    headers: { 'X-WOPI-Lock': decision.kind === 'mismatch' ? decision.currentLock : decision.lock },
  })
}
