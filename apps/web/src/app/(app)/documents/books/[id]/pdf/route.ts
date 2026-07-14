// GET /documents/books/:id/pdf
//
// Render a fresh document-book PDF on demand and stream it back to the browser.
//
// Replaces the previous print-friendly HTML response — the worker now
// concatenates the per-document bodies into a single letterheaded PDF and we
// stream the fresh artifact back to the browser.

import { and, eq } from 'drizzle-orm'
import { documentBooks } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { renderOnDemandPdfResponse } from '@/lib/pdf-route'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Book not found' }, { status: 404 })

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return Response.json({ error: 'No active tenant' }, { status: 400 })
  }
  if (!can(ctx, 'documents.read')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Readers may only render PUBLISHED books — draft books are manage-only,
  // matching the books list which shows non-managers published books only.
  const [book] = await ctx.db((tx) =>
    tx
      .select({ status: documentBooks.status })
      .from(documentBooks)
      .where(and(eq(documentBooks.tenantId, ctx.tenantId), eq(documentBooks.id, id)))
      .limit(1),
  )
  if (!book) return Response.json({ error: 'Book not found' }, { status: 404 })
  if (book.status !== 'published' && !can(ctx, 'documents.manage')) {
    return Response.json({ error: 'Book not found' }, { status: 404 })
  }

  const res = await renderOnDemandPdfResponse({
    kind: 'document_book',
    tenantId: ctx.tenantId,
    bookId: id,
  })
  if (res.ok) {
    await recordAudit(ctx, {
      entityType: 'document_book',
      entityId: id,
      action: 'export',
      summary: 'Exported document book to PDF',
      metadata: { format: 'pdf' },
    })
  }
  return res
}
