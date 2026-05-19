// GET /forms/responses/:id/pdf
//
// If form_responses.pdfAttachmentId is set, redirect to a signed GET URL.
// Otherwise enqueue a render job and return 202 with Retry-After.

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { attachments, formResponses } from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { requestFormResponsePdf } from '@/lib/pdf-actions'

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

  const existing = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ response: formResponses, attachment: attachments })
      .from(formResponses)
      .leftJoin(attachments, eq(attachments.id, formResponses.pdfAttachmentId))
      .where(eq(formResponses.id, id))
      .limit(1)
    return row
  })

  if (existing?.attachment) {
    const url = await presignGet({ key: existing.attachment.r2Key, expiresInSeconds: 300 })
    return NextResponse.redirect(url, { status: 307 })
  }

  const result = await requestFormResponsePdf(id)
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
