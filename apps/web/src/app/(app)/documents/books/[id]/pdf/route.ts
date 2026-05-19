// GET /documents/books/:id/pdf
//
// If a generated document book PDF already exists, redirect to a short-lived
// signed GET URL on the object store. Otherwise enqueue a render job and
// return 202 Accepted with a Retry-After hint so the caller can poll.
//
// Replaces the previous print-friendly HTML response — the worker now
// concatenates the per-document bodies into a single letterheaded PDF and we
// just hand the user a signed URL to download it.

import { NextResponse } from 'next/server'
import { and, desc, eq, like } from 'drizzle-orm'
import { attachments } from '@beaconhs/db/schema'
import { presignGet } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { requestDocumentBookPdf } from '@/lib/pdf-actions'

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

  const latest = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.contentType, 'application/pdf'),
          like(attachments.r2Key, `pdfs/document-books/${id}-%`),
        ),
      )
      .orderBy(desc(attachments.createdAt))
      .limit(1)
    return row
  })

  if (latest) {
    const url = await presignGet({ key: latest.r2Key, expiresInSeconds: 300 })
    return NextResponse.redirect(url, { status: 307 })
  }

  const result = await requestDocumentBookPdf(id)
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
