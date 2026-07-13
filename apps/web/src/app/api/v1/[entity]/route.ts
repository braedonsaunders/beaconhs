// /api/v1/{entity} — GET lists rows; POST creates a record (writable entities
// only). Both authenticate first (so unknown paths can't probe which entities
// exist without a valid key), then check the relevant permission.

import { NextResponse } from 'next/server'
import { REPORT_ENTITY_MAP } from '@beaconhs/reports'
import { authenticateApiKey } from '@/lib/api/auth'
import { readApiJsonBody } from '@/lib/api/body'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { readEntityRows } from '@/lib/api/query'
import { keyHasPermission, readPermissionForEntity } from '@/lib/api/permissions'
import { createEntity, isWritable, writePermissionForEntity } from '@/lib/api/write'
import { runIdempotentMutation } from '@/lib/api/idempotency'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ entity: string }> },
): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    const { entity: entityKey } = await params
    const entity = REPORT_ENTITY_MAP[entityKey]
    if (!entity) throw ApiError.notFound(`Unknown entity "${entityKey}"`)
    const requiredPermission = readPermissionForEntity(entity)
    if (!keyHasPermission(key.permissions, requiredPermission)) {
      throw ApiError.forbidden(
        `This key cannot read "${entityKey}" — grant permission ${requiredPermission}.`,
      )
    }

    const page = await readEntityRows(ctx, entity, new URL(req.url).searchParams)
    return NextResponse.json(
      { entity: entityKey, ...page },
      { headers: noStore(key.rateLimitHeaders) },
    )
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1] unhandled error', err)
    return errorResponse(err)
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ entity: string }> },
): Promise<NextResponse> {
  try {
    const auth = await authenticateApiKey(req)
    const { ctx, key } = auth
    const { entity: entityKey } = await params
    const entity = REPORT_ENTITY_MAP[entityKey]
    if (!entity) throw ApiError.notFound(`Unknown entity "${entityKey}"`)
    if (!isWritable(entityKey)) {
      throw ApiError.methodNotAllowed(`"${entityKey}" is read-only — POST is not supported.`)
    }
    const requiredPermission = writePermissionForEntity(entityKey)
    if (!requiredPermission) {
      throw ApiError.methodNotAllowed(`"${entityKey}" is read-only — POST is not supported.`)
    }
    if (!keyHasPermission(key.permissions, requiredPermission)) {
      throw ApiError.forbidden(
        `This key cannot write "${entityKey}" — grant permission ${requiredPermission}.`,
      )
    }

    const body = await readApiJsonBody(req)
    const result = await runIdempotentMutation(auth, req, body, async () => ({
      body: { entity: entityKey, data: await createEntity(ctx, entityKey, body) },
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
    if (!(err instanceof ApiError)) console.error('[api/v1] unhandled error', err)
    return errorResponse(err)
  }
}
