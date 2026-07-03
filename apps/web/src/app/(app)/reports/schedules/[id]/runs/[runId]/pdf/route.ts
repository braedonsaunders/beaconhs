// GET /reports/schedules/:id/runs/:runId/pdf
//
// Streams the run's PDF attachment through the app.
// Returns 404 if the run has no PDF yet (e.g. it's still queued/running, or
// failed before rendering).

import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { assertCan } from '@beaconhs/tenant'
import { attachments, reportRuns } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { storedPdfArtifactResponse } from '@/lib/pdf-route'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
): Promise<Response> {
  const { id, runId } = await params
  const ctx = await requireRequestContext()
  assertCan(ctx, 'reports.read')
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const found = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ run: reportRuns, attachment: attachments })
      .from(reportRuns)
      .leftJoin(attachments, eq(attachments.id, reportRuns.pdfAttachmentId))
      .where(and(eq(reportRuns.id, runId), eq(reportRuns.scheduleId, id)))
      .limit(1)
    return row ?? null
  })

  if (!found) {
    return NextResponse.json({ error: 'Run not found' }, { status: 404 })
  }
  if (!found.attachment) {
    return NextResponse.json(
      { error: 'PDF not yet available for this run', status: found.run.status },
      { status: 404 },
    )
  }

  try {
    const response = await storedPdfArtifactResponse({
      r2Key: found.attachment.r2Key,
      filename: found.attachment.filename,
    })
    await recordAudit(ctx, {
      entityType: 'report_run',
      entityId: runId,
      action: 'export',
      summary: `Downloaded report run PDF "${found.attachment.filename}"`,
      metadata: { scheduleId: id, attachmentId: found.attachment.id },
    })
    return response
  } catch (error) {
    console.error(`[pdf] report run artifact missing: ${found.attachment.r2Key}`, error)
    return NextResponse.json({ error: 'PDF artifact is missing from storage' }, { status: 410 })
  }
}
