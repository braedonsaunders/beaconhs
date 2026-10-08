import { getRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { loadHazidSigningRoster } from '@/lib/hazid-signing-roster'

export const dynamic = 'force-dynamic'
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isUuid(id)) return Response.json({ error: 'Not found' }, { status: 404 })
  const ctx = await getRequestContext()
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const data = await loadHazidSigningRoster(
    ctx,
    id,
    Object.fromEntries(new URL(request.url).searchParams),
  )
  return Response.json(data ?? { error: 'Not found' }, {
    status: data ? 200 : 404,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
