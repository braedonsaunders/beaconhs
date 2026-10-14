// GET /training/assessments/:id/pdf
//
// Render a training assessment attempt PDF on demand. Uses the tenant's
// configured template for the `training` module when one is set, else the
// generic record summary.

import { eq } from 'drizzle-orm'
import { trainingAssessments } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
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

  // Re-scope exactly like the detail page: proctors see any attempt, everyone
  // else only their own. Without this a self-scoped reader could pull a
  // colleague's scores by guessing an id.
  const isProctor = can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')
  const visible = await ctx.db(async (tx) => {
    const [attempt] = await tx
      .select({ personId: trainingAssessments.personId })
      .from(trainingAssessments)
      .where(eq(trainingAssessments.id, id))
      .limit(1)
    if (!attempt) return false
    if (isProctor) return true
    return canSeeRecord(ctx, tx, { prefix: 'training', personId: attempt.personId })
  })
  if (!visible) return Response.json({ error: 'Not found' }, { status: 404 })

  const response = await renderModulePdfResponse(ctx, { moduleKey: 'training', recordId: id })
  if (response.ok) {
    await recordAudit(ctx, {
      entityType: 'training_assessment',
      entityId: id,
      action: 'export',
      summary: 'Exported PDF',
      metadata: { format: 'pdf' },
    })
  }
  return response
}
