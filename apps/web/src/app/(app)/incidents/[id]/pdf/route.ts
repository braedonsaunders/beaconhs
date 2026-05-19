// GET /incidents/:id/pdf
//
// If a generated incident PDF already exists, redirect to a short-lived
// signed GET URL on the object store. Otherwise enqueue a render job and
// return 202 Accepted with a Retry-After hint so the caller can poll.

import { NextResponse } from 'next/server'
import { and, desc, eq, like } from 'drizzle-orm'
import { attachments, incidentAttachments } from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { requestIncidentPdf } from '@/lib/pdf-actions'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params
  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  // Find the most recent incident_attachment whose attachment is a PDF
  // matching our generated naming pattern.
  const latest = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ attachment: attachments })
      .from(incidentAttachments)
      .innerJoin(attachments, eq(attachments.id, incidentAttachments.attachmentId))
      .where(
        and(
          eq(incidentAttachments.incidentId, id),
          eq(attachments.contentType, 'application/pdf'),
          like(attachments.filename, 'incident-%'),
        ),
      )
      .orderBy(desc(attachments.createdAt))
      .limit(1)
    return row
  })

  if (latest) {
    const url = await presignGet({ key: latest.attachment.r2Key, expiresInSeconds: 300 })
    return NextResponse.redirect(url, { status: 307 })
  }

  // No PDF yet — enqueue and respond with a polling hint.
  const result = await requestIncidentPdf(id)
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return new NextResponse('PDF is being generated. Refresh in a few seconds.', {
    status: 202,
    headers: {
      'Retry-After': '5',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
