// Download the PowerPoint master of a PPTX-mastered training deck. Streams the
// current file (including edits saved in the in-browser editor) and audits the
// export.

import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { attachments } from '@beaconhs/db/schema'
import { getObjectStream } from '@beaconhs/storage'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { loadDeckMaster, parseDeckTarget } from '../_lib'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  routeCtx: { params: Promise<{ target: string; id: string }> },
) {
  const { target: targetRaw, id } = await routeCtx.params
  const target = parseDeckTarget(targetRaw)
  if (!target) return new NextResponse('Not found', { status: 404 })

  const ctx = await requireModuleManage('training')
  const master = await loadDeckMaster(ctx.db, target, id)
  if (!master) return new NextResponse('Not found', { status: 404 })

  const key = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ key: attachments.r2Key })
      .from(attachments)
      .where(eq(attachments.id, master.attachment.id))
      .limit(1)
    return row?.key ?? null
  })
  if (!key) return new NextResponse('Not found', { status: 404 })

  await recordAudit(ctx, {
    entityType: target === 'lesson' ? 'training_lesson' : 'training_content_item',
    entityId: id,
    action: 'export',
    summary: `Downloaded PowerPoint master "${master.attachment.filename}"`,
    metadata: { attachmentId: master.attachment.id },
  })

  const obj = await getObjectStream({ key })
  const filename = master.attachment.filename.replace(/[^\w.\- ]+/g, '_') || 'slides.pptx'
  return new NextResponse(obj.stream, {
    headers: {
      'Content-Type':
        obj.contentType ??
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      ...(obj.contentLength ? { 'Content-Length': String(obj.contentLength) } : {}),
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
