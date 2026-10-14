// /api/v1/briefs/{briefId}/runs — list a brief's runs, or generate one for an
// explicit date range (synchronous; the response is the finished run).

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import { readApiJsonBody } from '@/lib/api/body'
import { generateBriefRunApi, listBriefRunsApi } from '@/lib/api/briefs'
import { BRIEF_MANAGE_PERMISSION, BRIEF_READ_PERMISSION } from '@/lib/briefs/access'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { runIdempotentMutation } from '@/lib/api/idempotency'
import { keyHasPermission } from '@/lib/api/permissions'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

type Params = { params: Promise<{ briefId: string }> }

export async function GET(req: Request, { params }: Params): Promise<NextResponse> {
  try {
    const { briefId } = await params
    if (!isUuid(briefId)) throw ApiError.notFound('Brief not found')
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BRIEF_READ_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot read briefs — grant permission ${BRIEF_READ_PERMISSION}.`,
      )
    }
    const body = await listBriefRunsApi(ctx, briefId, new URL(req.url).searchParams)
    return NextResponse.json(body, { headers: noStore(key.rateLimitHeaders) })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1/briefs/:id/runs] unhandled error', err)
    return errorResponse(err)
  }
}

export async function POST(req: Request, { params }: Params): Promise<NextResponse> {
  try {
    const { briefId } = await params
    if (!isUuid(briefId)) throw ApiError.notFound('Brief not found')
    const auth = await authenticateApiKey(req)
    const { ctx, key } = auth
    if (!keyHasPermission(key.permissions, BRIEF_MANAGE_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot generate briefs — grant permission ${BRIEF_MANAGE_PERMISSION}.`,
      )
    }
    const body = await readApiJsonBody(req)
    const result = await runIdempotentMutation(auth, req, body, async () => ({
      body: await generateBriefRunApi(ctx, key.id, briefId, body),
      status: 201,
    }))
    return NextResponse.json(result.body, {
      status: result.status,
      headers: noStore({
        ...key.rateLimitHeaders,
        'Idempotency-Replayed': String(result.replayed),
      }),
    })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1/briefs/:id/runs] unhandled error', err)
    return errorResponse(err)
  }
}
