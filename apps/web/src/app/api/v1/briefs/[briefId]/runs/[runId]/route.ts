// /api/v1/briefs/{briefId}/runs/{runId} — one run with its written brief and
// the facts and records it was grounded in.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import { getBriefRunApi } from '@/lib/api/briefs'
import { BRIEF_READ_PERMISSION } from '@/lib/briefs/access'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { keyHasPermission } from '@/lib/api/permissions'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ briefId: string; runId: string }> },
): Promise<NextResponse> {
  try {
    const { briefId, runId } = await params
    if (!isUuid(briefId) || !isUuid(runId)) throw ApiError.notFound('Run not found')
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BRIEF_READ_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot read briefs — grant permission ${BRIEF_READ_PERMISSION}.`,
      )
    }
    return NextResponse.json(await getBriefRunApi(ctx, briefId, runId), {
      headers: noStore(key.rateLimitHeaders),
    })
  } catch (err) {
    if (!(err instanceof ApiError))
      console.error('[api/v1/briefs/:id/runs/:runId] unhandled error', err)
    return errorResponse(err)
  }
}
