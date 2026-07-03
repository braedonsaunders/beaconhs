// GET /documents/:id/pdf
//
// Render a fresh document PDF on demand and stream it back to the browser.

import { and, eq, isNull } from 'drizzle-orm'
import { documents } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'

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
  if (!can(ctx, 'documents.read')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Readers may only render PUBLISHED documents — the worker falls back to the
  // live draft when nothing is published, so a draft-status document must be
  // manage-only here (mirrors the detail page's notFound()).
  const [doc] = await ctx.db((tx) =>
    tx
      .select({ status: documents.status })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1),
  )
  if (!doc) return Response.json({ error: 'Document not found' }, { status: 404 })
  if (doc.status !== 'published' && !can(ctx, 'documents.manage')) {
    return Response.json({ error: 'Document not found' }, { status: 404 })
  }

  const res = await renderOnDemandPdfResponse({
    kind: 'document',
    tenantId: ctx.tenantId,
    documentId: id,
  })
  if (res.ok) {
    await recordAudit(ctx, {
      entityType: 'document',
      entityId: id,
      action: 'export',
      summary: 'Exported document to PDF',
      metadata: { format: 'pdf' },
    })
  }
  return res
}
