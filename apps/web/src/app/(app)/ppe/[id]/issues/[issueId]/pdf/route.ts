// GET /ppe/:id/issues/:issueId/pdf
//
// Render a fresh PPE issue-report PDF on demand and stream it back to the
// browser. Uses the tenant's configured template for the ppe-issues module
// when one is set, else the generic record summary.

import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { renderModulePdfResponse } from '@/lib/module-pdf'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
): Promise<Response> {
  const { issueId } = await params
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }
  assertCan(ctx, 'ppe.read.all')

  await recordAudit(ctx, {
    entityType: 'ppe_issue_report',
    entityId: issueId,
    action: 'export',
    summary: 'Exported PDF',
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, { moduleKey: 'ppe-issues', recordId: issueId })
}
