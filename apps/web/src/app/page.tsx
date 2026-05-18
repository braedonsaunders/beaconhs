import { redirect } from 'next/navigation'
import { getCurrentUserId } from '@/lib/auth'

export default async function RootPage() {
  const userId = await getCurrentUserId()
  if (userId) redirect('/dashboard')
  redirect('/login')
}
