import { redirect } from 'next/navigation'

// The PPE-type edit form is now inline on the detail page's General tab
// (one page = the detail view + edit surface). This route only redirects, so
// any old bookmark or `/edit` link lands on the unified page.
export default async function EditPpeTypeRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/ppe/types/${id}`)
}
