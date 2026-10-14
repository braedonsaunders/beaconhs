// /api/v1/briefs — AI briefs defined in this tenant.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import { listBriefsApi } from '@/lib/api/briefs'
import { BRIEF_READ_PERMISSION } from '@/lib/briefs/access'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { keyHasPermission } from '@/lib/api/permissions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BRIEF_READ_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot read briefs — grant permission ${BRIEF_READ_PERMISSION}.`,
      )
    }
    const body = await listBriefsApi(ctx, new URL(req.url).searchParams)
    return NextResponse.json(body, { headers: noStore(key.rateLimitHeaders) })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1/briefs] unhandled error', err)
    return errorResponse(err)
  }
}
