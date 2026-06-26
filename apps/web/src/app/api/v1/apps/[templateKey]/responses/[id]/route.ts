// /api/v1/apps/{templateKey}/responses/{id} — get, patch, or archive one
// Builder app response under the API key's tenant.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import {
  BUILDER_APP_DELETE_PERMISSION,
  BUILDER_APP_READ_PERMISSION,
  BUILDER_APP_UPDATE_PERMISSION,
  deleteBuilderAppResponse,
  getBuilderAppResponse,
  resolveBuilderApp,
  updateBuilderAppResponse,
} from '@/lib/api/builder-apps'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { keyHasPermission } from '@/lib/api/permissions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ templateKey: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BUILDER_APP_READ_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot read Builder app responses — grant permission ${BUILDER_APP_READ_PERMISSION}.`,
      )
    }
    const { templateKey, id } = await params
    const app = await resolveBuilderApp(ctx, templateKey)
    const response = await getBuilderAppResponse(ctx, app, id)
    if (!response) throw ApiError.notFound(`No response with id ${id}`)
    return NextResponse.json({ app: app.key, data: response }, { headers: noStore() })
  } catch (err) {
    if (!(err instanceof ApiError)) {
      console.error('[api/v1/apps/{templateKey}/responses/{id}] unhandled error', err)
    }
    return errorResponse(err)
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ templateKey: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BUILDER_APP_UPDATE_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot update Builder app responses — grant permission ${BUILDER_APP_UPDATE_PERMISSION}.`,
      )
    }
    const { templateKey, id } = await params
    const app = await resolveBuilderApp(ctx, templateKey)
    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw ApiError.invalid('Request body must be valid JSON')
    }
    const response = await updateBuilderAppResponse(ctx, app, id, body)
    return NextResponse.json({ app: app.key, data: response }, { headers: noStore() })
  } catch (err) {
    if (!(err instanceof ApiError)) {
      console.error('[api/v1/apps/{templateKey}/responses/{id}] unhandled error', err)
    }
    return errorResponse(err)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ templateKey: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BUILDER_APP_DELETE_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot delete Builder app responses — grant permission ${BUILDER_APP_DELETE_PERMISSION}.`,
      )
    }
    const { templateKey, id } = await params
    const app = await resolveBuilderApp(ctx, templateKey)
    const deleted = await deleteBuilderAppResponse(ctx, app, id)
    return NextResponse.json({ app: app.key, data: deleted }, { headers: noStore() })
  } catch (err) {
    if (!(err instanceof ApiError)) {
      console.error('[api/v1/apps/{templateKey}/responses/{id}] unhandled error', err)
    }
    return errorResponse(err)
  }
}
