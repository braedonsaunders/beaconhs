// GET /equipment/work-orders/:id/pdf
//
// Render a fresh work-order PDF on demand and stream it back to the browser.

import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
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
  assertCan(ctx, 'equipment.read.all')

  await recordAudit(ctx, {
    entityType: 'equipment_work_order',
    entityId: id,
    action: 'export',
    summary: 'Exported PDF',
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, { moduleKey: 'equipment', recordId: id })
}
