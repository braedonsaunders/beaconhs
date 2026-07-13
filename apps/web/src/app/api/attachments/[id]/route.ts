import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { attachments } from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import { validateAttachmentCapability } from '../../../../lib/attachment-url'
import { getRequestContext } from '../../../../lib/auth'

export const dynamic = 'force-dynamic'

const idSchema = z.string().uuid()

/**
 * Stable authenticated capability used by persisted form values. Both the
 * unforgeable capability and the caller's active tenant RLS scope must match;
 * neither a session nor an attachment UUID alone authorizes delivery.
 */
export async function GET(
  request: NextRequest,
  routeContext: { params: Promise<{ id: string }> },
): Promise<Response> {
  const parsedId = idSchema.safeParse((await routeContext.params).id)
  if (!parsedId.success) return new NextResponse('Not found', { status: 404 })
  const cap = request.nextUrl.searchParams.get('cap') ?? ''
  if (!validateAttachmentCapability(parsedId.data, cap)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const ctx = await getRequestContext()
  if (!ctx) return new NextResponse('Unauthorized', { status: 401 })
  const attachment = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ r2Key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, parsedId.data))
      .limit(1)
    return row ?? null
  })
  if (!attachment) return new NextResponse('Not found', { status: 404 })

  const signedUrl = await presignGet({ key: attachment.r2Key, expiresInSeconds: 60 })
  const response = NextResponse.redirect(signedUrl, 307)
  response.headers.set('Cache-Control', 'private, no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
