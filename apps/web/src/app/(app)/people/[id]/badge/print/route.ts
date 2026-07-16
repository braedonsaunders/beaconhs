import { NextResponse, type NextRequest } from 'next/server'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { renderPersonBadgePngs } from '@/lib/person-badge'
import { sendCardPressoPrint } from '@/lib/cardpresso'

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
    const images = await renderPersonBadgePngs(ctx, personId)
    if (!images?.[0]) return NextResponse.json({ error: 'Person not found.' }, { status: 404 })
    const result = await sendCardPressoPrint({ front: images[0], back: images[1] })
    await recordAudit(ctx, {
      entityType: 'person_badge',
      entityId: personId,
      action: 'export',
      summary: 'Sent ID badge to cardPresso',
      metadata: result,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error('[cardpresso] person badge print failed', { personId, error })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'cardPresso printing failed.' },
      { status: 502 },
    )
  }
}
