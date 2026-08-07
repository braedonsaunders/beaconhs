import { notFound, redirect } from 'next/navigation'

import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

// The inspection is filled in a flyout on the register, exactly like a PPE
// inspection — there is no standalone page for it. This route only exists so
// existing deep links (the maintenance cockpit, a unit's schedule row, an old
// bookmark) still land on the right record with its flyout open.
export default async function EquipmentInspectionRecordRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  redirect(`/equipment/inspections?drawer=inspection&inspectionId=${encodeURIComponent(id)}`)
}
