import { redirect } from 'next/navigation'

// Editing an asset is now the detail page's "Edit" tab (EquipmentEditTab) —
// one page = the detail view + edit surface. This legacy route only redirects,
// so any old bookmark or `/edit` link lands on the unified page's edit tab.
export default async function EditEquipmentRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/equipment/${id}?tab=edit`)
}
