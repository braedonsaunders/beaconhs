import { redirect } from 'next/navigation'

// Bank settings now live on the Settings tab of the bank builder. This route is
// kept as a redirect so any older links continue to work.
export default async function EditInspectionBankRedirect({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/inspections/banks/${id}`)
}
