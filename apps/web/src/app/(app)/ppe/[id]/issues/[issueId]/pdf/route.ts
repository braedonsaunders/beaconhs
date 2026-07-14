// GET /ppe/:id/issues/:issueId/pdf
//
// Render a fresh PPE issue-report PDF on demand and stream it back to the
// browser. Uses the tenant's configured template for the ppe-issues module
// when one is set, else the generic record summary.

import { assertCan } from '@beaconhs/tenant'
import { and, eq } from 'drizzle-orm'
import { ppeIssueReports } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { renderModulePdfResponse } from '@/lib/module-pdf'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
): Promise<Response> {
  const { id, issueId } = await params
  if (!isUuid(id) || !isUuid(issueId)) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }
  assertCan(ctx, 'ppe.read.all')

  const [issue] = await ctx.db((tx) =>
    tx
      .select({ id: ppeIssueReports.id })
      .from(ppeIssueReports)
      .where(and(eq(ppeIssueReports.id, issueId), eq(ppeIssueReports.itemId, id)))
      .limit(1),
  )
  if (!issue) return Response.json({ error: 'Not found' }, { status: 404 })

  await recordAudit(ctx, {
    entityType: 'ppe_issue_report',
    entityId: issueId,
    action: 'export',
    summary: 'Exported PDF',
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, { moduleKey: 'ppe-issues', recordId: issueId })
}
