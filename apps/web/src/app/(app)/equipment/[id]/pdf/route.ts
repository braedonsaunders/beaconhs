// GET /equipment/:id/pdf
//
// Render an equipment asset record PDF on demand — the register sheet for one
// unit. Uses the tenant's configured template for the `equipment-assets` module
// when one is set, else the generic record summary.
//
// Distinct from /equipment/:id/qr/pdf, which prints the thermal QR label from
// the design-studio label designer.

import { and, eq, isNull } from 'drizzle-orm'
import { equipmentItems } from '@beaconhs/db/schema'
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

  // Same read tier as the detail page: read.all → any asset, read.site → the
  // caller's sites, neither → only what they hold.
  const visible = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        siteId: equipmentItems.currentSiteOrgUnitId,
        holderId: equipmentItems.currentHolderPersonId,
      })
      .from(equipmentItems)
      .where(and(eq(equipmentItems.id, id), isNull(equipmentItems.deletedAt)))
      .limit(1)
    if (!row) return false
    return canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      siteId: row.siteId,
      personId: row.holderId,
    })
  })
  if (!visible) return Response.json({ error: 'Not found' }, { status: 404 })

  const response = await renderModulePdfResponse(ctx, {
    moduleKey: 'equipment-assets',
    recordId: id,
  })
  if (response.ok) {
    await recordAudit(ctx, {
      entityType: 'equipment',
      entityId: id,
      action: 'export',
      summary: 'Exported PDF',
      metadata: { format: 'pdf' },
    })
  }
  return response
}
