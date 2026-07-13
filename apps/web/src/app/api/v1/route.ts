// GET /api/v1 — unauthenticated service discovery: version, where the docs and
// spec live, and the list of readable entities with their endpoints + permissions.

import { NextResponse } from 'next/server'
import { REPORT_ENTITIES } from '@beaconhs/reports'
import { authenticateApiKey } from '@/lib/api/auth'
import {
  BUILDER_APP_CREATE_PERMISSION,
  BUILDER_APP_DELETE_PERMISSION,
  BUILDER_APP_READ_PERMISSION,
  BUILDER_APP_UPDATE_PERMISSION,
  listBuilderApps,
} from '@/lib/api/builder-apps'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { keyHasPermission, readPermissionForEntity } from '@/lib/api/permissions'
import { isRecordable } from '@/lib/api/records'
import {
  deletePermissionForEntity,
  isDeletable,
  isPatchable,
  isWritable,
  patchPermissionForEntity,
  writePermissionForEntity,
} from '@/lib/api/write'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const origin = new URL(req.url).origin
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization')
    let builderApps = null
    let rateLimitHeaders: Record<string, string> = {}
    if (authHeader) {
      const { ctx, key } = await authenticateApiKey(req)
      rateLimitHeaders = key.rateLimitHeaders
      if (keyHasPermission(key.permissions, BUILDER_APP_READ_PERMISSION)) {
        builderApps = await listBuilderApps(ctx, key.builderTemplateIds)
      }
    }
    return NextResponse.json(
      {
        name: 'BeaconHS Public API',
        version: '1.0.0',
        documentation: `${origin}/api/v1/docs`,
        openapi: `${origin}/api/v1/openapi.json`,
        authentication: 'Bearer token — Authorization: Bearer bhs_live_…',
        builder_apps: {
          endpoint: '/api/v1/apps',
          readPermission: BUILDER_APP_READ_PERMISSION,
          createPermission: BUILDER_APP_CREATE_PERMISSION,
          updatePermission: BUILDER_APP_UPDATE_PERMISSION,
          deletePermission: BUILDER_APP_DELETE_PERMISSION,
          responses: '/api/v1/apps/{templateKey}/responses',
          record: '/api/v1/apps/{templateKey}/responses/{id}',
          concrete_apps: builderApps,
        },
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
          update: isPatchable(e.key)
            ? { method: 'PATCH', permission: patchPermissionForEntity(e.key) }
            : null,
          delete: isDeletable(e.key)
            ? { method: 'DELETE', permission: deletePermissionForEntity(e.key) }
            : null,
        })),
      },
      { headers: noStore(rateLimitHeaders) },
    )
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1] discovery error', err)
    return errorResponse(err)
  }
}
