// WOPI CheckFileInfo — called server-to-server by Collabora Online when a
// PowerPoint editing session opens. Public route: authentication is the
// single-file HMAC access_token minted by the editor page (see lib/wopi.ts),
// not a session cookie — Collabora never has one.

import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import { attachments } from '@beaconhs/db/schema'
import { verifyWopiToken } from '@/lib/wopi'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params
  const token = req.nextUrl.searchParams.get('access_token') ?? ''
  const grant = verifyWopiToken(token, fileId)
  if (!grant) return new NextResponse('Invalid or expired WOPI token', { status: 401 })

  const att = await withTenant(db, grant.tenantId, async (tx) => {
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
    SupportsLocks: false,
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
