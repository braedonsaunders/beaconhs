// GET /api/v1/openapi.json — the generated OpenAPI 3.1 document. Without auth
// it serves the static API surface plus generic Builder app paths. With a valid
// Bearer token it enriches the spec with that tenant's concrete published
// Builder app paths and schemas.

import { NextResponse } from 'next/server'
import { REPORT_ENTITIES, loadCustomFieldColumns, type ReportEntityColumn } from '@beaconhs/reports'
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
    // Fold the tenant's custom-field columns into the documented schema/params.
    const customColumns = await ctx.db(async (tx) => {
      const out: Record<string, ReportEntityColumn[]> = {}
      for (const entity of REPORT_ENTITIES) {
        const cols = await loadCustomFieldColumns(tx, entity.table)
        if (cols.length) out[entity.key] = cols
      }
      return out
    })
    return NextResponse.json(buildOpenApiDocument(origin, { builderApps, customColumns }), {
      headers: noStore(),
    })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1/openapi.json] unhandled error', err)
    return errorResponse(err)
  }
}
