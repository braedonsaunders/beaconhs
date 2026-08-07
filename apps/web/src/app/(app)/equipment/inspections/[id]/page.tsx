import { notFound, redirect } from 'next/navigation'

import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

// The inspection is filled in a flyout on the register, exactly like a PPE
// inspection — there is no standalone page for it. This route only exists so
// existing deep links (the maintenance cockpit, a unit's schedule row, an old
// bookmark) still land on the right record with its flyout open.
export default async function EquipmentInspectionRecordRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ issue?: string }>
}) {
  const { id } = await params
  const { issue } = await searchParams
  if (!isUuid(id)) notFound()
  const search = new URLSearchParams({ drawer: 'inspection', inspectionId: id })
  if (issue) search.set('issue', issue)
  redirect(`/equipment/inspections?${search.toString()}`)
}
