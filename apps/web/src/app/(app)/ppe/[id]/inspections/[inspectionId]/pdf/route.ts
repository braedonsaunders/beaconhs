// GET /ppe/:id/inspections/:inspectionId/pdf
//
// Render a fresh PPE inspection PDF on demand and stream it back to the
// browser — the printable record of a pre-use or annual check, with every
// criterion as a line item. Uses the tenant's configured template for the
// `ppe` module when one is set, else the generic record summary.

import { assertCan } from '@beaconhs/tenant'
import { and, eq } from 'drizzle-orm'
import { ppeInspections } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { renderModulePdfResponse } from '@/lib/module-pdf'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; inspectionId: string }> },
): Promise<Response> {
  const { id, inspectionId } = await params
  if (!isUuid(id) || !isUuid(inspectionId)) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }
  assertCan(ctx, 'ppe.read.all')

  // Re-scope before rendering: the inspection must belong to the item in the
  // URL, so a guessed id can't pull another item's inspection.
  const [inspection] = await ctx.db((tx) =>
    tx
      .select({ id: ppeInspections.id })
      .from(ppeInspections)
      .where(and(eq(ppeInspections.id, inspectionId), eq(ppeInspections.itemId, id)))
      .limit(1),
  )
  if (!inspection) return Response.json({ error: 'Not found' }, { status: 404 })

  await recordAudit(ctx, {
    entityType: 'ppe_inspection',
    entityId: inspectionId,
    action: 'export',
    summary: 'Exported PDF',
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, { moduleKey: 'ppe', recordId: inspectionId })
}
