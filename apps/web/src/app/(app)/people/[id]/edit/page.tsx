import { redirect } from 'next/navigation'

// Editing a person is now the detail page's "Edit" tab (PersonEditTab) — one
// page = the detail view + edit surface. This legacy route only redirects, so
// any old bookmark or `/edit` link lands on the unified page's edit tab.
export default async function EditPersonRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/people/${id}?tab=edit`)
}
