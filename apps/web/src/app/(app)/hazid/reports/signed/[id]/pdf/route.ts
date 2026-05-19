// GET /hazid/reports/signed/:id/pdf
//
// Resolves the freshly-rendered signed-report bundle to a short-lived signed
// URL on the object store, then 307-redirects to it so the browser downloads
// the PDF without exposing the underlying r2 key. If the report row is still
// pending/rendering we return 202 with a Retry-After hint so the caller can
// poll the detail page.

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { attachments, hazidSignedReports } from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'

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

  const row = await ctx.db(async (tx) => {
    const [r] = await tx
      .select({ report: hazidSignedReports, attachment: attachments })
      .from(hazidSignedReports)
      .leftJoin(attachments, eq(attachments.id, hazidSignedReports.pdfAttachmentId))
      .where(eq(hazidSignedReports.id, id))
      .limit(1)
    return r ?? null
  })

  if (!row || !row.report) {
    return NextResponse.json({ error: 'Bundle not found' }, { status: 404 })
  }

  // Only completed/ready bundles have an attachment. Anything else gets a
  // 202 so the caller (typically the detail page) can refresh.
  if (!row.attachment) {
    return new NextResponse('Bundle is still rendering. Refresh in a few seconds.', {
      status: 202,
      headers: {
        'Retry-After': '5',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }

  const url = await presignGet({ key: row.attachment.r2Key, expiresInSeconds: 300 })
  return NextResponse.redirect(url, { status: 307 })
}
