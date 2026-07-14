// GET /corrective-actions/:id/pdf
//
// Render a fresh corrective-action PDF on demand and stream it back to the browser.

import { and, eq, isNull } from 'drizzle-orm'
import { correctiveActions } from '@beaconhs/db/schema'
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
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }

  // Re-scope before rendering: a self/site-tier user must not be able to pull a
  // PDF of a corrective action they cannot see by guessing its id.
  const visible = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        ownerTenantUserId: correctiveActions.ownerTenantUserId,
        siteOrgUnitId: correctiveActions.siteOrgUnitId,
      })
      .from(correctiveActions)
      .where(and(eq(correctiveActions.id, id), isNull(correctiveActions.deletedAt)))
      .limit(1)
    if (!row) return false
    return canSeeRecord(ctx, tx, {
      prefix: 'ca',
      ownerIds: [row.ownerTenantUserId],
      siteId: row.siteOrgUnitId,
    })
  })
  if (!visible) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  await recordAudit(ctx, {
    entityType: 'corrective_action',
    entityId: id,
    action: 'export',
    summary: 'Exported PDF',
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, { moduleKey: 'corrective-actions', recordId: id })
}
