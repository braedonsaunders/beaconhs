import { redirect } from 'next/navigation'

// The incident detail page is now a single-page live-edit form — there is no
// separate edit surface. This legacy route only redirects, so any old bookmark
// or `/edit` link lands on the unified detail page.
export default async function EditIncidentRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/incidents/${id}`)
}
