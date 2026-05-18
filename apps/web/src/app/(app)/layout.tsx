import { redirect } from 'next/navigation'
import { getRequestContext } from '@/lib/auth'
import { AppShell } from '@/components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext()
  if (!ctx) redirect('/login')
  return <AppShell ctx={ctx}>{children}</AppShell>
}
