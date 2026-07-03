// GET /incidents/:id/pdf
//
// Render a fresh incident PDF on demand and stream it back to the browser.

import { and, eq, isNull } from 'drizzle-orm'
import { incidents } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
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

  // Re-scope before rendering: a self/site-tier user must not be able to pull a
  // PDF of an incident they cannot see by guessing its id.
  const visible = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        reportedByTenantUserId: incidents.reportedByTenantUserId,
        siteOrgUnitId: incidents.siteOrgUnitId,
      })
      .from(incidents)
      .where(and(eq(incidents.id, id), isNull(incidents.deletedAt)))
      .limit(1)
    if (!row) return false
    return canSeeRecord(ctx, tx, {
      prefix: 'incidents',
      ownerIds: [row.reportedByTenantUserId],
      siteId: row.siteOrgUnitId,
    })
  })
  if (!visible) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  await recordAudit(ctx, {
    entityType: 'incident',
    entityId: id,
    action: 'export',
    summary: 'Exported PDF',
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, {
    moduleKey: 'incidents',
    recordId: id,
    builtin: { kind: 'incident', tenantId: ctx.tenantId, incidentId: id },
  })
}
