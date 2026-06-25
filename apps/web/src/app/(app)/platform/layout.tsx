import { redirect } from 'next/navigation'
import { requireRequestContext } from '@/lib/auth'

// Single authorization gate for the entire platform (super-admin) area. Every
// page under /platform is deployment-wide, so it must NOT be reachable by tenant
// users — this is also what closes the prior gap where /admin/tenants only
// checked for a session, not super-admin.
export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireRequestContext()
  if (!ctx.isSuperAdmin) redirect('/admin')
  return <>{children}</>
}
