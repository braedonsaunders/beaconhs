import { NextResponse, type NextRequest } from 'next/server'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { readBoundedJsonBody } from '@/lib/request-body'
import { skillCertificateForAssignment } from '@/lib/training-credential-access'
import { renderSkillCredentialPngs } from '@/lib/training-credential-pdf'
import { sendCardPressoPrint } from '@/lib/cardpresso'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: assignmentId } = await params
  if (!isUuid(assignmentId))
    return NextResponse.json({ error: 'Skill assignment not found.' }, { status: 404 })

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
  const access = await skillCertificateForAssignment(ctx, assignmentId)
  if ('error' in access)
    return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const images = await renderSkillCredentialPngs(ctx, access.certificateId, { outputId })
    if (!images?.[0]) {
      return NextResponse.json(
        { error: 'This output is not a wallet-card design.' },
        { status: 409 },
      )
    }
    const result = await sendCardPressoPrint({ front: images[0], back: images[1] })
    await recordAudit(ctx, {
      entityType: 'training_skill',
      entityId: assignmentId,
      action: 'export',
      summary: 'Sent skill wallet card to cardPresso',
      metadata: { certificateId: access.certificateId, outputId, ...result },
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cardpresso] skill credential print failed', { assignmentId, error })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'cardPresso printing failed.' },
      { status: 502 },
    )
  }
}
