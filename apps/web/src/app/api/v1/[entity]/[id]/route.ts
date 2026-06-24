// GET /api/v1/{entity}/{id} — fetch a single record by id, RLS-scoped to the
// API key's tenant. Only physical-table entities are recordable; the report_*
// views are list-only and 404 here.

import { NextResponse } from 'next/server'
import { REPORT_ENTITY_MAP } from '@beaconhs/reports'
import { authenticateApiKey } from '@/lib/api/auth'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { getEntityRecord } from '@/lib/api/query'
import { isRecordable, isUuid } from '@/lib/api/records'
import { keyCanRead } from '@/lib/api/scopes'

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
    if (!keyCanRead(key.scopes, entityKey)) {
      throw ApiError.forbidden(
        `This key cannot read "${entityKey}" — grant scope read:${entityKey} or read:*.`,
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
