// GET /api/v1/openapi.json — the generated OpenAPI 3.1 document. Structural only
// (entity + column names, identical for every tenant; no tenant data), so it is
// served without auth and lightly cached. The data endpoints it describes still
// require a key.

import { NextResponse } from 'next/server'
import { buildOpenApiDocument } from '@/lib/api/openapi'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<NextResponse> {
  const origin = new URL(req.url).origin
  return NextResponse.json(buildOpenApiDocument(origin), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
