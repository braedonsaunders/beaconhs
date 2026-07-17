import { NextResponse, type NextRequest } from 'next/server'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { readBoundedJsonBody } from '@/lib/request-body'
import { trainingCertificateForRecord } from '@/lib/training-credential-access'
import { renderTrainingCredentialPngs } from '@/lib/training-credential-pdf'
import { sendDirectPrint, DIRECT_PRINT_PROVIDER_LABELS } from '@/lib/direct-printing'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: recordId } = await params
  if (!isUuid(recordId))
    return NextResponse.json({ error: 'Training record not found.' }, { status: 404 })

  let outputId = ''
  try {
    const body = await readBoundedJsonBody(request, { maxBytes: 2048, timeoutMs: 5000 })
    outputId =
      body &&
      typeof body === 'object' &&
      typeof (body as { outputId?: unknown }).outputId === 'string'
        ? (body as { outputId: string }).outputId.trim()
        : ''
  } catch {
    return NextResponse.json({ error: 'Choose a valid wallet-card design.' }, { status: 400 })
  }
  if (!outputId || outputId.length > 64) {
    return NextResponse.json({ error: 'Choose a valid wallet-card design.' }, { status: 400 })
  }

  const ctx = await requireRequestContext()
  const access = await trainingCertificateForRecord(ctx, recordId)
  if ('error' in access)
    return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const rendered = await renderTrainingCredentialPngs(ctx, access.certificateId, { outputId })
    if (!rendered?.images[0]) {
      return NextResponse.json(
        { error: 'This output is not a wallet-card design.' },
        { status: 409 },
      )
    }
    const result = await sendDirectPrint(ctx, rendered.provider, {
      front: rendered.images[0],
      back: rendered.images[1],
    })
    await recordAudit(ctx, {
      entityType: 'training_record',
      entityId: recordId,
      action: 'export',
      summary: `Sent training wallet card to ${DIRECT_PRINT_PROVIDER_LABELS[rendered.provider]}`,
      metadata: { certificateId: access.certificateId, outputId, ...result },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[direct-print] training credential print failed', { recordId, error })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Direct printing failed.' },
      { status: 502 },
    )
  }
}
