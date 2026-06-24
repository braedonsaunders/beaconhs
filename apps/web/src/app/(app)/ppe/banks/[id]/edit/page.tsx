import { redirect } from 'next/navigation'

// Settings moved into the bank builder's Settings tab — this route just
// redirects to the builder so old links keep working.
export default async function PpeBankEditRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/ppe/banks/${id}`)
}
