import { NextResponse, type NextRequest } from 'next/server'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { renderPersonBadgePngs } from '@/lib/person-badge'
import { sendDirectPrint, DIRECT_PRINT_PROVIDER_LABELS } from '@/lib/direct-printing'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: personId } = await params
  if (!isUuid(personId)) return NextResponse.json({ error: 'Person not found.' }, { status: 404 })

  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'people')
  try {
    const rendered = await renderPersonBadgePngs(ctx, personId)
    if (!rendered?.images[0])
      return NextResponse.json({ error: 'Person not found.' }, { status: 404 })
    const result = await sendDirectPrint(ctx, rendered.provider, {
      front: rendered.images[0],
      back: rendered.images[1],
    })
    await recordAudit(ctx, {
      entityType: 'person_badge',
      entityId: personId,
      action: 'export',
      summary: `Sent ID badge to ${DIRECT_PRINT_PROVIDER_LABELS[rendered.provider]}`,
      metadata: result,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[direct-print] person badge print failed', { personId, error })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Direct printing failed.' },
      { status: 502 },
    )
  }
}
