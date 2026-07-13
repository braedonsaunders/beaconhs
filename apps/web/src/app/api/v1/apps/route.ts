// /api/v1/apps — tenant-specific Builder app discovery for public API keys.

import { NextResponse } from 'next/server'
import { authenticateApiKey } from '@/lib/api/auth'
import { BUILDER_APP_READ_PERMISSION, listBuilderApps } from '@/lib/api/builder-apps'
import { ApiError, errorResponse, noStore } from '@/lib/api/errors'
import { keyHasPermission } from '@/lib/api/permissions'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  try {
    const { ctx, key } = await authenticateApiKey(req)
    if (!keyHasPermission(key.permissions, BUILDER_APP_READ_PERMISSION)) {
      throw ApiError.forbidden(
        `This key cannot list Builder apps — grant permission ${BUILDER_APP_READ_PERMISSION}.`,
      )
    }
    const apps = await listBuilderApps(ctx, key.builderTemplateIds)
    return NextResponse.json({ data: apps }, { headers: noStore(key.rateLimitHeaders) })
  } catch (err) {
    if (!(err instanceof ApiError)) console.error('[api/v1/apps] unhandled error', err)
    return errorResponse(err)
  }
}
