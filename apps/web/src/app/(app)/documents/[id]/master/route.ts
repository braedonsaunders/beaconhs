// Download a document's DOCX working master (manage-only — it contains
// unpublished edits). Audited as an export.

import { NextResponse, type NextRequest } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { attachments, documents } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { getObjectStream } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  routeCtx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await routeCtx.params
  if (!isUuid(id)) return new NextResponse('Not found', { status: 404 })

  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.manage')

  const att = await ctx.db(async (tx) => {
    const [doc] = await tx
      .select({ sourceAttachmentId: documents.sourceAttachmentId })
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1)
    if (!doc?.sourceAttachmentId) return null
    const [row] = await tx
      .select({ key: attachments.r2Key, filename: attachments.filename })
      .from(attachments)
      .where(eq(attachments.id, doc.sourceAttachmentId))
      .limit(1)
    return row ?? null
  })
  if (!att) return new NextResponse('Not found', { status: 404 })

  await recordAudit(ctx, {
    entityType: 'document',
    entityId: id,
    action: 'export',
    summary: `Downloaded working document "${att.filename}"`,
  })

  const obj = await getObjectStream({ key: att.key })
  const filename = att.filename.replace(/[^\w.\- ]+/g, '_') || 'document.docx'
  return new NextResponse(obj.stream, {
    headers: {
      'Content-Type':
        obj.contentType ??
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ...(obj.contentLength ? { 'Content-Length': String(obj.contentLength) } : {}),
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
