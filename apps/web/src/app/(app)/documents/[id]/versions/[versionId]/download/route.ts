// Download a published version's artifact: ?kind=pdf (default — the document
// of record) or ?kind=docx (the immutable Word snapshot). Readers can fetch
// published versions; unpublished snapshots require documents.manage.

import { NextResponse, type NextRequest } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { attachments, documentVersions } from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { getObjectStream } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  routeCtx: { params: Promise<{ id: string; versionId: string }> },
): Promise<Response> {
  const { id, versionId } = await routeCtx.params
  if (!isUuid(id) || !isUuid(versionId)) return new NextResponse('Not found', { status: 404 })

  const kind = req.nextUrl.searchParams.get('kind') === 'docx' ? 'docx' : 'pdf'
  const ctx = await requireRequestContext()
  assertCan(ctx, 'documents.read')

  const att = await ctx.db(async (tx) => {
    const [v] = await tx
      .select({
        version: documentVersions.version,
        publishedAt: documentVersions.publishedAt,
        docxAttachmentId: documentVersions.docxAttachmentId,
        pdfAttachmentId: documentVersions.pdfAttachmentId,
        contentAttachmentId: documentVersions.contentAttachmentId,
      })
      .from(documentVersions)
      .where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, id)))
      .limit(1)
    if (!v) return null
    if (!v.publishedAt && !can(ctx, 'documents.manage')) return null
    const attachmentId =
      kind === 'docx' ? v.docxAttachmentId : (v.pdfAttachmentId ?? v.contentAttachmentId)
    if (!attachmentId) return null
    const [row] = await tx
      .select({ key: attachments.r2Key, filename: attachments.filename })
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .limit(1)
    return row ? { ...row, versionNumber: v.version } : null
  })
  if (!att) return new NextResponse('Not found', { status: 404 })

  await recordAudit(ctx, {
    entityType: 'document',
    entityId: id,
    action: 'export',
    summary: `Downloaded v${att.versionNumber} ${kind.toUpperCase()} "${att.filename}"`,
    metadata: { versionId, kind },
  })

  const obj = await getObjectStream({ key: att.key })
  const filename = att.filename.replace(/[^\w.\- ]+/g, '_') || `document.${kind}`
  return new NextResponse(obj.stream, {
    headers: {
      'Content-Type': obj.contentType ?? 'application/octet-stream',
      ...(obj.contentLength ? { 'Content-Length': String(obj.contentLength) } : {}),
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
