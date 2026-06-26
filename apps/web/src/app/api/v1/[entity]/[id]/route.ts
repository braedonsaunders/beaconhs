// /api/v1/{entity}/{id} — fetch, update or soft-delete a single record by id,
// RLS-scoped to the API key's tenant. Only physical-table entities are
// recordable; the report_* views are list-only and 404 here.

import { NextResponse } from 'next/server'
import { REPORT_ENTITY_MAP } from '@beaconhs/reports'
import { authenticateApiKey } from '@/lib/api/auth'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { getEntityRecord } from '@/lib/api/query'
import { isRecordable, isUuid } from '@/lib/api/records'
import { keyHasPermission, readPermissionForEntity } from '@/lib/api/permissions'
import {
  deleteEntity,
  deletePermissionForEntity,
  isDeletable,
  isPatchable,
  patchEntity,
  patchPermissionForEntity,
} from '@/lib/api/write'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ entity: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    const { entity: entityKey, id } = await params
    const entity = REPORT_ENTITY_MAP[entityKey]
    if (!entity || !isRecordable(entityKey)) {
      throw ApiError.notFound(`No record endpoint for "${entityKey}"`)
    }
    const requiredPermission = readPermissionForEntity(entity)
    if (!keyHasPermission(key.permissions, requiredPermission)) {
      throw ApiError.forbidden(
        `This key cannot read "${entityKey}" — grant permission ${requiredPermission}.`,
      )
    }
    if (!isUuid(id)) throw ApiError.invalid('Record id must be a uuid')

    const record = await getEntityRecord(ctx, entity, id)
    if (!record) throw ApiError.notFound(`No ${entityKey} with id ${id}`)
    return NextResponse.json({ entity: entityKey, data: record }, { headers: noStore() })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1] unhandled error', err)
    return errorResponse(err)
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ entity: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    const { entity: entityKey, id } = await params
    const entity = REPORT_ENTITY_MAP[entityKey]
    if (!entity || !isRecordable(entityKey)) {
      throw ApiError.notFound(`No record endpoint for "${entityKey}"`)
    }
    if (!isUuid(id)) throw ApiError.invalid('Record id must be a uuid')
    if (!isPatchable(entityKey)) {
      throw ApiError.methodNotAllowed(`"${entityKey}" does not support PATCH updates.`)
    }
    const requiredPermission = patchPermissionForEntity(entityKey)
    if (!requiredPermission) {
      throw ApiError.methodNotAllowed(`"${entityKey}" does not support PATCH updates.`)
    }
    if (!keyHasPermission(key.permissions, requiredPermission)) {
      throw ApiError.forbidden(
        `This key cannot update "${entityKey}" — grant permission ${requiredPermission}.`,
      )
    }

    let body: unknown
    try {
      body = await req.json()
    } catch {
      throw ApiError.invalid('Request body must be valid JSON')
    }

    const updated = await patchEntity(ctx, entityKey, id, body)
    return NextResponse.json({ entity: entityKey, data: updated }, { headers: noStore() })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1] unhandled error', err)
    return errorResponse(err)
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ entity: string; id: string }> },
): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    const { entity: entityKey, id } = await params
    const entity = REPORT_ENTITY_MAP[entityKey]
    if (!entity || !isRecordable(entityKey)) {
      throw ApiError.notFound(`No record endpoint for "${entityKey}"`)
    }
    if (!isUuid(id)) throw ApiError.invalid('Record id must be a uuid')
    if (!isDeletable(entityKey)) {
      throw ApiError.methodNotAllowed(`"${entityKey}" does not support DELETE.`)
    }
    const requiredPermission = deletePermissionForEntity(entityKey)
    if (!requiredPermission) {
      throw ApiError.methodNotAllowed(`"${entityKey}" does not support DELETE.`)
    }
    if (!keyHasPermission(key.permissions, requiredPermission)) {
      throw ApiError.forbidden(
        `This key cannot delete "${entityKey}" — grant permission ${requiredPermission}.`,
      )
    }

    const deleted = await deleteEntity(ctx, entityKey, id)
    return NextResponse.json({ entity: entityKey, data: deleted }, { headers: noStore() })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1] unhandled error', err)
    return errorResponse(err)
  }
}
