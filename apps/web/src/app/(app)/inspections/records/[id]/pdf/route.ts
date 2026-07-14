// GET /inspections/records/:id/pdf
//
// Render an inspection record PDF on demand. Uses the tenant's configured
// template for the inspections module when one is set, else the generic
// record summary.

import { and, eq, isNull } from 'drizzle-orm'
import { inspectionRecords } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { renderModulePdfResponse } from '@/lib/module-pdf'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })

  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.read.self')
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }

  // Per-user record visibility: a read.self/site user must not pull the PDF of a
  // record they can't see by guessing its id. Mirrors the detail page guard.
  const [rec] = await ctx.db((tx) =>
    tx
      .select({
        inspectorTenantUserId: inspectionRecords.inspectorTenantUserId,
        submittedByTenantUserId: inspectionRecords.submittedByTenantUserId,
        siteOrgUnitId: inspectionRecords.siteOrgUnitId,
      })
      .from(inspectionRecords)
      .where(
        and(
          eq(inspectionRecords.tenantId, ctx.tenantId),
          eq(inspectionRecords.id, id),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .limit(1),
  )
  if (!rec) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const visible = await ctx.db((tx) =>
    canSeeRecord(ctx, tx, {
      prefix: 'inspections',
      ownerIds: [rec.inspectorTenantUserId, rec.submittedByTenantUserId],
      siteId: rec.siteOrgUnitId,
    }),
  )
  if (!visible) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: id,
    action: 'export',
    summary: 'Exported PDF',
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, { moduleKey: 'inspections', recordId: id })
}
