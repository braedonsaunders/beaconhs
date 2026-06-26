// GET /api/v1/openapi.json — the generated OpenAPI 3.1 document. Without auth
// it serves the static API surface plus generic Builder app paths. With a valid
// Bearer token it enriches the spec with that tenant's concrete published
// Builder app paths and schemas.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import { BUILDER_APP_READ_PERMISSION, listBuilderAppOpenApiEntities } from '@/lib/api/builder-apps'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { buildOpenApiDocument } from '@/lib/api/openapi'
import { keyHasPermission } from '@/lib/api/permissions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const origin = new URL(req.url).origin
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
    if (!authHeader) {
      return NextResponse.json(buildOpenApiDocument(origin), {
        headers: { 'Cache-Control': 'public, max-age=300' },
      })
    }

    const { ctx, key } = await authenticateApiKey(req)
    const builderApps = keyHasPermission(key.permissions, BUILDER_APP_READ_PERMISSION)
      ? await listBuilderAppOpenApiEntities(ctx)
      : []
    return NextResponse.json(buildOpenApiDocument(origin, { builderApps }), {
      headers: noStore(),
    })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1/openapi.json] unhandled error', err)
    return errorResponse(err)
  }
}
