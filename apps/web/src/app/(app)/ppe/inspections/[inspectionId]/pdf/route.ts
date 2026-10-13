// GET /ppe/inspections/:inspectionId/pdf
//
// Render a fresh PPE inspection PDF on demand and stream it back to the
// browser — the printable record of a pre-use or annual check, registered item
// or other PPE, with every criterion as a line item. Uses the tenant's
// configured template for the `ppe` module when one is set, else the generic
// record summary.

import { assertCan, can } from '@beaconhs/tenant'
import { eq } from 'drizzle-orm'
import { ppeInspections } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { renderModulePdfResponse } from '@/lib/module-pdf'
import { isRouterPrefetch } from '@/lib/router-prefetch'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ inspectionId: string }> },
): Promise<Response> {
  if (isRouterPrefetch(request)) return new Response(null, { status: 204 })

  const { inspectionId } = await params
  if (!isUuid(inspectionId)) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }

  const [inspection] = await ctx.db((tx) =>
    tx
      .select({ id: ppeInspections.id, inspectedBy: ppeInspections.inspectedByTenantUserId })
      .from(ppeInspections)
      .where(eq(ppeInspections.id, inspectionId))
      .limit(1),
  )
  if (!inspection) return Response.json({ error: 'Not found' }, { status: 404 })
  // Readers of all PPE may print any inspection; an inspector may print their own.
  const ownInspection = ctx.membership?.id != null && inspection.inspectedBy === ctx.membership.id
  if (!ownInspection && !can(ctx, 'ppe.manage')) assertCan(ctx, 'ppe.read.all')

  const response = await renderModulePdfResponse(ctx, { moduleKey: 'ppe', recordId: inspectionId })
  if (response.ok)
    await recordAudit(ctx, {
      entityType: 'ppe_inspection',
      entityId: inspectionId,
      action: 'export',
      summary: 'Exported PDF',
      metadata: { format: 'pdf' },
    })

  return response
}
