// GET /training/records/:id/certificate?output=certificate
//
// Resolves the training_certificate row for the given record, creating one
// lazily if the record has never been issued a certificate (records entered
// manually or migrated never pass through the LMS completion flow that
// normally creates the row). The PDF itself is rendered on demand so design
// updates apply instantly and stale generated files never need invalidation.
//
// `output` selects one of the tenant's saved credential designs.
// `format=wallet|cert` is retained for legacy links.

import { randomBytes } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { trainingCertificates, trainingRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
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
  const outputId = req.nextUrl.searchParams.get('output')

  const ctx = await requireRequestContext()
  if (!ctx.tenantId) {
    return NextResponse.json({ error: 'No active tenant' }, { status: 400 })
  }

  const result = await ctx.db(async (tx) => {
    const [record] = await tx
      .select({
        id: trainingRecords.id,
        personId: trainingRecords.personId,
        deletedAt: trainingRecords.deletedAt,
      })
      .from(trainingRecords)
      .where(eq(trainingRecords.id, recordId))
      .limit(1)
    if (!record) return { error: 'Training record not found.', status: 404 } as const

    // Same per-record visibility gate as the detail page: read.all/super-admin →
    // any record; otherwise only the viewer's own training. Without this any
    // authenticated user could download (and lazily issue) anyone's certificate
    // PDF by guessing the record id.
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'training',
      personId: record.personId,
    })
    if (!visible) return { error: 'Training record not found.', status: 404 } as const

    let [cert] = await tx
      .select()
      .from(trainingCertificates)
      .where(eq(trainingCertificates.recordId, recordId))
      .orderBy(desc(trainingCertificates.createdAt))
      .limit(1)

    // Lazy issuance: any live (non-revoked) record can produce a credential.
    if (!cert) {
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

  const rendered = await renderTrainingCredentialPdf(ctx, result.cert.id, {
    outputId,
    format: pdfFormat,
  })
  if (!rendered) {
    return NextResponse.json({ error: 'Training certificate not found.' }, { status: 404 })
  }
  return pdfResponse(rendered)
}
