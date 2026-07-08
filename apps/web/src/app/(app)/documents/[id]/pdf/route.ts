// GET /documents/:id/pdf — on-demand PDF of the CURRENT working master (the
// manager's Write→PDF preview, rendered from the DOCX by the worker). The
// published document of record has its own immutable per-version PDFs; this
// route is manage-only because the draft may contain unpublished edits.

import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { documents } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(
  _req: Request,
  routeCtx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await routeCtx.params
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')

  const [doc] = await ctx.db((tx) =>
    tx
      .select({ sourceAttachmentId: documents.sourceAttachmentId })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1),
  )
  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  if (!doc.sourceAttachmentId) {
    return NextResponse.json({ error: 'This document has no Word file to render' }, { status: 400 })
  }

  return renderOnDemandPdfResponse({
    kind: 'document_master_pdf',
    tenantId: ctx.tenantId,
    documentId: id,
  })
}
