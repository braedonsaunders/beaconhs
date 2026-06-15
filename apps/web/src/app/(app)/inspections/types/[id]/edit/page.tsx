import { redirect } from 'next/navigation'

// Type settings now live on the Settings tab of the type builder. This route is
// kept as a redirect so any older links continue to work.
export default async function EditInspectionTypeRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/inspections/types/${id}`)
}
