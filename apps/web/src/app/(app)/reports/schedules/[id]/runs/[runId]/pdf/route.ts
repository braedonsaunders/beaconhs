// GET /reports/schedules/:id/runs/:runId/pdf
//
// Redirects to a short-lived signed GET URL for the run's PDF attachment.
// Returns 404 if the run has no PDF yet (e.g. it's still queued/running, or
// failed before rendering).

import { NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { attachments, reportRuns } from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
): Promise<Response> {
  const { id, runId } = await params
  const ctx = await requireRequestContext()
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

  const url = await presignGet({ key: found.attachment.r2Key, expiresInSeconds: 300 })
  return NextResponse.redirect(url, { status: 307 })
}
