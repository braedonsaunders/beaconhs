// GET /documents/:id/pdf
//
// Render a fresh document PDF on demand and stream it back to the browser.

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

  return renderOnDemandPdfResponse({ kind: 'document', tenantId: ctx.tenantId, documentId: id })
}
