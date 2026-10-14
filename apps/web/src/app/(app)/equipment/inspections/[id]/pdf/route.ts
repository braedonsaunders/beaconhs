// GET /equipment/inspections/:id/pdf
//
// Render an equipment check PDF on demand — the printable record of one
// pre-use/periodic inspection with every criterion as a line item. Uses the
// tenant's configured template for the `equipment-inspections` module when one
// is set, else the generic record summary.

import { eq } from 'drizzle-orm'
import { equipmentInspectionRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@beaconhs/tenant/visibility'
import { recordAudit } from '@/lib/audit'
import { renderModulePdfResponse } from '@/lib/module-pdf'
import { isUuid } from '@/lib/list-params'
import { isRouterPrefetch } from '@/lib/router-prefetch'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (isRouterPrefetch(request)) return new Response(null, { status: 204 })

  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return Response.json({ error: 'No active tenant' }, { status: 400 })

  // Scope on the equipment read tier, like the register the record is filled
  // from: read.all → any check, read.site → the caller's sites, neither → only
  // checks they carried out.
  const visible = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        siteId: equipmentInspectionRecords.siteOrgUnitId,
        inspectorPersonId: equipmentInspectionRecords.inspectorPersonId,
      })
      .from(equipmentInspectionRecords)
      .where(eq(equipmentInspectionRecords.id, id))
      .limit(1)
    if (!row) return false
    return canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      siteId: row.siteId,
      personId: row.inspectorPersonId,
    })
  })
  if (!visible) return Response.json({ error: 'Not found' }, { status: 404 })

  const response = await renderModulePdfResponse(ctx, {
    moduleKey: 'equipment-inspections',
    recordId: id,
  })
  if (response.ok) {
    await recordAudit(ctx, {
      entityType: 'equipment_inspection_record',
      entityId: id,
      action: 'export',
      summary: 'Exported PDF',
      metadata: { format: 'pdf' },
    })
  }
  return response
}
