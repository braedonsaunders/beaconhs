// GET /documents/sign-off-sessions/:sessionId/pdf
//
// Render a document sign-off session PDF on demand — the acknowledgement
// register: who was asked, who signed, and when. Uses the tenant's configured
// template for the `document-signoffs` module when one is set, else the generic
// record summary.

import { and, eq, isNull } from 'drizzle-orm'
import { documentAcknowledgmentSessions } from '@beaconhs/db/schema'
import { canFacilitateDocumentSignoff } from '@/lib/document-signoff-permission'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { renderModulePdfResponse } from '@/lib/module-pdf'
import { isUuid } from '@/lib/list-params'
import { isRouterPrefetch } from '@/lib/router-prefetch'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
  if (isRouterPrefetch(request)) return new Response(null, { status: 204 })

  const { sessionId } = await params
  if (!isUuid(sessionId)) return Response.json({ error: 'Not found' }, { status: 404 })

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) return Response.json({ error: 'No active tenant' }, { status: 400 })
  // The register names every person asked to sign, so it follows the same
  // permission as the sign-off surface it is printed from.
  if (!canFacilitateDocumentSignoff(ctx))
    return Response.json({ error: 'Forbidden' }, { status: 403 })

  const [session] = await ctx.db((tx) =>
    tx
      .select({ id: documentAcknowledgmentSessions.id })
      .from(documentAcknowledgmentSessions)
      .where(
        and(
          eq(documentAcknowledgmentSessions.id, sessionId),
          isNull(documentAcknowledgmentSessions.deletedAt),
        ),
      )
      .limit(1),
  )
  if (!session) return Response.json({ error: 'Not found' }, { status: 404 })

  const response = await renderModulePdfResponse(ctx, {
    moduleKey: 'document-signoffs',
    recordId: sessionId,
  })
  if (response.ok) {
    await recordAudit(ctx, {
      entityType: 'document_acknowledgment_session',
      entityId: sessionId,
      action: 'export',
      summary: 'Exported PDF',
      metadata: { format: 'pdf' },
    })
  }
  return response
}
