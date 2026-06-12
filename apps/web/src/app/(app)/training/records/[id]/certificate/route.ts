// GET /training/records/:id/certificate?format=cert|wallet
//
// Resolves the training_certificate row for the given record, creating one
// lazily if the record has never been issued a certificate (records entered
// manually or migrated never pass through the LMS completion flow that
// normally creates the row). The PDF itself is rendered on demand so design
// updates apply instantly and stale generated files never need invalidation.
//
// `format=wallet` returns the wallet card variant.
// `format=cert` (default) returns the full-size certificate.

import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { trainingCertificates, trainingRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import {
  pdfResponse,
  renderTrainingCredentialPdf,
  type CredentialPdfFormat,
} from '@/lib/training-credential-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: recordId } = await params
  const format = (req.nextUrl.searchParams.get('format') ?? 'cert').toLowerCase()
  const pdfFormat: CredentialPdfFormat = format === 'wallet' ? 'wallet' : 'cert'

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const result = await ctx.db(async (tx) => {
    let [cert] = await tx
      .select()
      .from(trainingCertificates)
      .where(eq(trainingCertificates.recordId, recordId))
      .orderBy(desc(trainingCertificates.createdAt))
      .limit(1)

    // Lazy issuance: any live (non-revoked) record can produce a credential.
    if (!cert) {
      const [record] = await tx
        .select({ id: trainingRecords.id, deletedAt: trainingRecords.deletedAt })
        .from(trainingRecords)
        .where(eq(trainingRecords.id, recordId))
        .limit(1)
      if (!record) return { error: 'Training record not found.', status: 404 } as const
      if (record.deletedAt) {
        return {
          error: 'This record has been revoked; no certificate can be issued.',
          status: 409,
        } as const
      }
      const [created] = await tx
        .insert(trainingCertificates)
        .values({
          tenantId: ctx.tenantId!,
          recordId,
          verifyToken: randomBytes(20).toString('hex'),
        })
        .returning()
      cert = created
    }
    if (!cert) return { error: 'Failed to issue certificate.', status: 500 } as const

    return { cert } as const
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const rendered = await renderTrainingCredentialPdf(ctx, result.cert.id, pdfFormat)
  if (!rendered) {
    return NextResponse.json({ error: 'Training certificate not found.' }, { status: 404 })
  }
  return pdfResponse(rendered)
}
