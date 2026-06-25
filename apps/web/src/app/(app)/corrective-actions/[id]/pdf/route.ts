// GET /corrective-actions/:id/pdf
//
// Render a fresh corrective-action PDF on demand and stream it back to the browser.

import { requireRequestContext } from '@/lib/auth'
import { renderModulePdfResponse } from '@/lib/module-pdf'

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

  return renderModulePdfResponse(ctx, {
    moduleKey: 'corrective-actions',
    recordId: id,
    builtin: { kind: 'ca', tenantId: ctx.tenantId, caId: id },
  })
}
