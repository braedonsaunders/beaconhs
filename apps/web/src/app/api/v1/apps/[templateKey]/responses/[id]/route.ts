// /api/v1/apps/{templateKey}/responses/{id} — get, patch, or archive one
// Builder app response under the API key's tenant.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import { readApiJsonBody } from '@/lib/api/body'
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
import { runIdempotentMutation } from '@/lib/api/idempotency'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ templateKey: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { templateKey, id } = await params
    if (!isUuid(id)) throw ApiError.invalid('Response id must be a uuid')

    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BUILDER_APP_READ_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot read Builder app responses — grant permission ${BUILDER_APP_READ_PERMISSION}.`,
      )
    }
    const app = await resolveBuilderApp(ctx, templateKey, key.builderTemplateIds)
    const response = await getBuilderAppResponse(ctx, app, id)
    if (!response) throw ApiError.notFound(`No response with id ${id}`)
    return NextResponse.json(
      { app: app.key, data: response },
      { headers: noStore(key.rateLimitHeaders) },
    )
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
    const { templateKey, id } = await params
    if (!isUuid(id)) throw ApiError.invalid('Response id must be a uuid')

    const auth = await authenticateApiKey(req)
    const { ctx, key } = auth
    if (!keyHasPermission(key.permissions, BUILDER_APP_UPDATE_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot update Builder app responses — grant permission ${BUILDER_APP_UPDATE_PERMISSION}.`,
      )
    }
    const app = await resolveBuilderApp(ctx, templateKey, key.builderTemplateIds)
    const body = await readApiJsonBody(req)
    const result = await runIdempotentMutation(auth, req, body, async () => ({
      body: { app: app.key, data: await updateBuilderAppResponse(ctx, app, id, body) },
      status: 200,
    }))
    return NextResponse.json(result.body, {
      headers: noStore({
        ...key.rateLimitHeaders,
        'Idempotency-Replayed': String(result.replayed),
      }),
    })
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
    const { templateKey, id } = await params
    if (!isUuid(id)) throw ApiError.invalid('Response id must be a uuid')

    const auth = await authenticateApiKey(req)
    const { ctx, key } = auth
    if (!keyHasPermission(key.permissions, BUILDER_APP_DELETE_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot delete Builder app responses — grant permission ${BUILDER_APP_DELETE_PERMISSION}.`,
      )
    }
    const app = await resolveBuilderApp(ctx, templateKey, key.builderTemplateIds)
    const result = await runIdempotentMutation(auth, req, null, async () => ({
      body: { app: app.key, data: await deleteBuilderAppResponse(ctx, app, id) },
      status: 200,
    }))
    return NextResponse.json(result.body, {
      headers: noStore({
        ...key.rateLimitHeaders,
        'Idempotency-Replayed': String(result.replayed),
      }),
    })
  } catch (err) {
    if (!(err instanceof ApiError)) {
      console.error('[api/v1/apps/{templateKey}/responses/{id}] unhandled error', err)
    }
    return errorResponse(err)
  }
}
