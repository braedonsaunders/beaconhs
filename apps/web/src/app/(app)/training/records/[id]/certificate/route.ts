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
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { pdfResponse, renderTrainingCredentialPdf } from '@/lib/training-credential-pdf'
import { trainingCertificateForRecord } from '@/lib/training-credential-access'
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
  const result = await trainingCertificateForRecord(ctx, recordId)

  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const rendered = await renderTrainingCredentialPdf(ctx, result.certificateId, {
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
    metadata: { certificateId: result.certificateId, outputId },
    dedupKey: `training-record-credential-export:${result.certificateId}:${outputId ?? 'default'}`,
  })

  return pdfResponse(rendered)
}
