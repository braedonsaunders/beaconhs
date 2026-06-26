// /api/v1/apps/{templateKey}/responses — list or submit responses for one
// published Builder app, addressed by the tenant's stable app key or template id.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import {
  BUILDER_APP_CREATE_PERMISSION,
  BUILDER_APP_READ_PERMISSION,
  createBuilderAppResponse,
  listBuilderAppResponses,
  resolveBuilderApp,
} from '@/lib/api/builder-apps'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { keyHasPermission } from '@/lib/api/permissions'

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
    const app = await resolveBuilderApp(ctx, templateKey)
    const page = await listBuilderAppResponses(ctx, app, new URL(req.url).searchParams)
    return NextResponse.json({ app: app.key, ...page }, { headers: noStore() })
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
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BUILDER_APP_CREATE_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot submit Builder app responses — grant permission ${BUILDER_APP_CREATE_PERMISSION}.`,
      )
    }
    const { templateKey } = await params
    const app = await resolveBuilderApp(ctx, templateKey)
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw ApiError.invalid('Request body must be valid JSON')
    }
    const response = await createBuilderAppResponse(ctx, app, body)
    return NextResponse.json({ app: app.key, data: response }, { status: 201, headers: noStore() })
  } catch (err) {
    if (!(err instanceof ApiError)) {
      console.error('[api/v1/apps/{templateKey}/responses] unhandled error', err)
    }
    return errorResponse(err)
  }
}
