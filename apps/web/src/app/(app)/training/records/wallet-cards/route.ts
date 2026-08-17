import { NextResponse, type NextRequest } from 'next/server'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { parseBulkActionIds } from '@/lib/bulk-actions'
import { trainingCertificateForRecord } from '@/lib/training-credential-access'
import { renderTrainingWalletCardBatchPdf } from '@/lib/training-credential-pdf'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_WALLET_CARDS = 50

export async function POST(request: NextRequest): Promise<Response> {
  const ctx = await requireRequestContext()
  if (!can(ctx, 'training.read.all') && !can(ctx, 'training.read.self')) {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'The record selection is invalid.' }, { status: 400 })
  }
  const selected = parseBulkActionIds(
    payload && typeof payload === 'object' ? (payload as { recordIds?: unknown }).recordIds : null,
    { singular: 'record', plural: 'records' },
  )
  if (!selected.ok) return NextResponse.json({ error: selected.error }, { status: 400 })
  if (selected.ids.length > MAX_WALLET_CARDS) {
    return NextResponse.json(
      { error: `Select no more than ${MAX_WALLET_CARDS} records per print run.` },
      { status: 400 },
    )
  }

  const certificateIds: string[] = []
  let skipped = 0
  for (const recordId of selected.ids) {
    const certificate = await trainingCertificateForRecord(ctx, recordId)
    if ('error' in certificate) {
      skipped += 1
      continue
    }
    certificateIds.push(certificate.certificateId)
  }
  if (certificateIds.length === 0) {
    return NextResponse.json(
      { error: 'None of the selected records has an available wallet card.' },
      { status: 409 },
    )
  }

  const rendered = await renderTrainingWalletCardBatchPdf(ctx, certificateIds)
  if (!rendered) {
    return NextResponse.json(
      { error: 'The selected courses do not have an enabled wallet-card design.' },
      { status: 409 },
    )
  }
  skipped += rendered.skipped

  await recordAudit(ctx, {
    entityType: 'training_record',
    action: 'export',
    summary: `Printed ${rendered.rendered} training wallet card${rendered.rendered === 1 ? '' : 's'}`,
    metadata: {
      recordIds: selected.ids,
      rendered: rendered.rendered,
      skipped,
      output: 'wallet',
    },
  })

  return new Response(new Uint8Array(rendered.bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(rendered.bytes.length),
      'Content-Disposition': `attachment; filename="${rendered.filename}"`,
      'Cache-Control': 'no-store',
      'X-Rendered-Records': String(rendered.rendered),
      'X-Skipped-Records': String(skipped),
    },
  })
}
