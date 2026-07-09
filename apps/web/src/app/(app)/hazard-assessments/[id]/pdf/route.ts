// GET /hazard-assessments/:id/pdf
//
// Render a fresh HazID assessment PDF on demand and stream it back to the browser.

import { and, eq, isNull } from 'drizzle-orm'
import { hazidAssessments } from '@beaconhs/db/schema'
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
  // PDF of an assessment they cannot see (or a soft-deleted one) by guessing
  // its id.
  const assessment = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({
        reference: hazidAssessments.reference,
        reportedByTenantUserId: hazidAssessments.reportedByTenantUserId,
        siteOrgUnitId: hazidAssessments.siteOrgUnitId,
      })
      .from(hazidAssessments)
      .where(and(eq(hazidAssessments.id, id), isNull(hazidAssessments.deletedAt)))
      .limit(1)
    if (!row) return null
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'hazid',
      ownerIds: [row.reportedByTenantUserId],
      siteId: row.siteOrgUnitId,
    })
    return visible ? row : null
  })
  if (!assessment) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }

  // Exports are audited. The header buttons link here with plain <a> anchors
  // (never <Link>) so router prefetch can't log phantom exports.
  await recordAudit(ctx, {
    entityType: 'hazid_assessment',
    entityId: id,
    action: 'export',
    summary: `Exported hazard assessment ${assessment.reference} to PDF`,
    metadata: { format: 'pdf' },
  })

  return renderModulePdfResponse(ctx, { moduleKey: 'hazid', recordId: id })
}
