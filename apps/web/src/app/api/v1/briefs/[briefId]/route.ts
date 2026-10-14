// /api/v1/briefs/{briefId} — one AI brief's definition.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import { getBriefApi } from '@/lib/api/briefs'
import { BRIEF_READ_PERMISSION } from '@/lib/briefs/access'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { keyHasPermission } from '@/lib/api/permissions'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ briefId: string }> },
): Promise<NextResponse> {
  try {
    const { briefId } = await params
    if (!isUuid(briefId)) throw ApiError.notFound('Brief not found')
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BRIEF_READ_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot read briefs — grant permission ${BRIEF_READ_PERMISSION}.`,
      )
    }
    return NextResponse.json(await getBriefApi(ctx, briefId), {
      headers: noStore(key.rateLimitHeaders),
    })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1/briefs/:id] unhandled error', err)
    return errorResponse(err)
  }
}
