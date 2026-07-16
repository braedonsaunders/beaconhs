// GET /training/records/:id/certificate?output=certificate
//
// Resolves the training_certificate row for the given record, creating one
// lazily if the record has never been issued a certificate (records entered
// manually or migrated never pass through the LMS completion flow that
// normally creates the row). The PDF itself is rendered on demand so design
// updates apply instantly and stale generated files never need invalidation.
//
// `output` selects one of the tenant's saved credential designs.

import { NextResponse, type NextRequest } from 'next/server'
import { eq } from 'drizzle-orm'
import { trainingRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { canSeeRecord } from '@/lib/visibility'
import { recordAudit } from '@/lib/audit'
import { issueTrainingCertificate } from '@/lib/training-certificate-issuance'
import { pdfResponse, renderTrainingCredentialPdf } from '@/lib/training-credential-pdf'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: recordId } = await params
  if (!isUuid(recordId)) {
    return NextResponse.json({ error: 'Training record not found.' }, { status: 404 })
  }

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

    // A revoked record must not produce a fresh, valid-looking credential —
    // whether or not a certificate row was already issued (revokeRecord marks
    // both the record and its certificates).
    if (record.deletedAt) {
      return {
        error: 'This record has been revoked; the certificate is no longer valid.',
        status: 409,
      } as const
    }

    // Lazy issuance: any live (non-revoked) record can produce a credential.
    // The shared issuer is safe when multiple downloads race for first issue.
    const cert = await issueTrainingCertificate(tx, { tenantId: ctx.tenantId, recordId })
    if (cert.revokedAt) {
      return {
        error: 'This certificate has been revoked and can no longer be downloaded.',
        status: 409,
      } as const
    }

    return { cert } as const
  })

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const rendered = await renderTrainingCredentialPdf(ctx, result.cert.id, {
    outputId,
  })
  if (!rendered) {
    return NextResponse.json({ error: 'Training certificate not found.' }, { status: 404 })
  }

  // Credential PDFs are personal-data exports — audit them like the CSV routes.
  await recordAudit(ctx, {
    entityType: 'training_record',
    entityId: recordId,
    action: 'export',
    summary: 'Downloaded training credential PDF',
    metadata: { certificateId: result.cert.id, outputId },
    dedupKey: `training-record-credential-export:${result.cert.id}:${outputId ?? 'default'}`,
  })

  return pdfResponse(rendered)
}
