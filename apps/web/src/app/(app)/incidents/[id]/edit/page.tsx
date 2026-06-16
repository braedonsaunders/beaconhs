import { redirect } from 'next/navigation'

// Editing an incident is now the detail page's "Edit" tab (IncidentEditTab) —
// one page = the detail view + edit surface. This legacy route only redirects,
// so any old bookmark or `/edit` link lands on the unified page's edit tab.
export default async function EditIncidentRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/incidents/${id}?tab=edit`)
}
