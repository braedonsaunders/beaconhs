// Deep-link target for the QR labels printed at /equipment/[id]/qr and
// /equipment/qr/bulk. Scanning a label with a phone lands here; we resolve the
// asset and bounce into the station with it pre-loaded so the operator can check
// it in/out in one tap. The (app) layout already gates auth (→ /login).

import { redirect, notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { equipmentItems } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function EquipmentScanPage({
  params,
}: {
  params: Promise<{ qrToken: string }>
}) {
  const { qrToken } = await params
  const ctx = await requireRequestContext()
  const [item] = await ctx.db((tx) =>
    tx
      .select({ id: equipmentItems.id })
      .from(equipmentItems)
      .where(and(eq(equipmentItems.qrToken, qrToken), isNull(equipmentItems.deletedAt)))
      .limit(1),
  )
  if (!item) notFound()
  redirect(`/equipment/station?code=${encodeURIComponent(qrToken)}`)
}
