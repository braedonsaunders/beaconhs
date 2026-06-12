// GET /documents/:id/pdf
//
// Render a fresh document PDF on demand and stream it back to the browser.

import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }
  if (!ctx.isSuperAdmin && !can(ctx, 'documents.read')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  return renderOnDemandPdfResponse({ kind: 'document', tenantId: ctx.tenantId, documentId: id })
}
