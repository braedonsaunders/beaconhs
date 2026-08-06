import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

// The full-page "start an inspection" form is gone — picking the equipment and
// the inspection happens in the register's flyout, and a unit's own page opens
// that flyout with the equipment already fixed.
//
// This route must never create a record: a GET can be fired by prefetch,
// history re-navigation, or a cross-site top-level link, so creation always
// requires the explicit submit in the flyout (a POST server action). Existing
// links carrying ?itemId= keep working by pre-selecting the unit.
export default async function NewEquipmentInspectionRedirect({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string; itemId?: string }>
}) {
  const { itemId, typeId } = await searchParams
  const params = new URLSearchParams({ drawer: 'new' })
  if (itemId) params.set('itemId', itemId)
  if (typeId) params.set('typeId', typeId)
  redirect(`/equipment/inspections?${params.toString()}`)
}
