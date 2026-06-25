// GET /equipment/work-orders/:id/pdf
//
// Render a fresh work-order PDF on demand and stream it back to the browser.

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
    moduleKey: 'equipment',
    recordId: id,
    builtin: { kind: 'equipment_workorder', tenantId: ctx.tenantId, workOrderId: id },
  })
}
