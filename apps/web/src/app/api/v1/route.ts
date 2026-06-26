// GET /api/v1 — unauthenticated service discovery: version, where the docs and
// spec live, and the list of readable entities with their endpoints + permissions.

import { NextResponse } from 'next/server'
import { REPORT_ENTITIES } from '@beaconhs/reports'
import { noStore } from '@/lib/api/errors'
import { readPermissionForEntity } from '@/lib/api/permissions'
import { isRecordable } from '@/lib/api/records'
import { isWritable, writePermissionForEntity } from '@/lib/api/write'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  const origin = new URL(req.url).origin
  return NextResponse.json(
    {
      name: 'BeaconHS Public API',
      version: '1.0.0',
      documentation: `${origin}/api/v1/docs`,
      openapi: `${origin}/api/v1/openapi.json`,
      authentication: 'Bearer token — Authorization: Bearer bhs_live_…',
      entities: REPORT_ENTITIES.map((e) => ({
        key: e.key,
        label: e.label,
        description: e.description,
        endpoint: `/api/v1/${e.key}`,
        readPermission: readPermissionForEntity(e),
        record: isRecordable(e.key) ? `/api/v1/${e.key}/{id}` : null,
        create: isWritable(e.key)
          ? { method: 'POST', permission: writePermissionForEntity(e.key) }
          : null,
      })),
    },
    { headers: noStore() },
  )
}
