// /api/v1/apps/{templateKey}/responses — list or submit responses for one
// published Builder app, addressed by the tenant's stable app key or template id.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import { readApiJsonBody } from '@/lib/api/body'
import {
  BUILDER_APP_CREATE_PERMISSION,
  BUILDER_APP_READ_PERMISSION,
  createBuilderAppResponse,
  listBuilderAppResponses,
  resolveBuilderApp,
} from '@/lib/api/builder-apps'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { keyHasPermission } from '@/lib/api/permissions'
import { runIdempotentMutation } from '@/lib/api/idempotency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ templateKey: string }> },
): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BUILDER_APP_READ_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot read Builder app responses — grant permission ${BUILDER_APP_READ_PERMISSION}.`,
      )
    }
    const { templateKey } = await params
    const app = await resolveBuilderApp(ctx, templateKey, key.builderTemplateIds)
    const page = await listBuilderAppResponses(ctx, app, new URL(req.url).searchParams)
    return NextResponse.json({ app: app.key, ...page }, { headers: noStore(key.rateLimitHeaders) })
  } catch (err) {
    if (!(err instanceof ApiError)) {
      console.error('[api/v1/apps/{templateKey}/responses] unhandled error', err)
    }
    return errorResponse(err)
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ templateKey: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticateApiKey(req)
    const { ctx, key } = auth
    if (!keyHasPermission(key.permissions, BUILDER_APP_CREATE_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot submit Builder app responses — grant permission ${BUILDER_APP_CREATE_PERMISSION}.`,
      )
    }
    const { templateKey } = await params
    const app = await resolveBuilderApp(ctx, templateKey, key.builderTemplateIds)
    const body = await readApiJsonBody(req)
    const result = await runIdempotentMutation(auth, req, body, async () => ({
      body: { app: app.key, data: await createBuilderAppResponse(ctx, app, body) },
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
    if (!(err instanceof ApiError)) {
      console.error('[api/v1/apps/{templateKey}/responses] unhandled error', err)
    }
    return errorResponse(err)
  }
}
