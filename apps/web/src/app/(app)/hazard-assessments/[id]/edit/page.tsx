import { redirect } from 'next/navigation'

// The hazard-assessment detail page is now the single, unified view/edit
// surface — every field is editable inline (lock- and permission-gated), so the
// standalone editor is retired. Redirect any old links/bookmarks to it.
export const dynamic = 'force-dynamic'

export default async function EditHazidAssessmentRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/hazard-assessments/${id}`)
}
