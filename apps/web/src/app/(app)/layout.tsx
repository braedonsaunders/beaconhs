import { redirect } from 'next/navigation'
import { db } from '@beaconhs/db'
import { tenants } from '@beaconhs/db/schema'
import { eq, sql } from 'drizzle-orm'
import { getRequestContext, listAccessibleTenants } from '@/lib/auth'
import { AppShell } from '@/components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext()
  if (!ctx) redirect('/login')

  const [tenant, available] = await Promise.all([
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.bypass_rls', 'on', true)`)
      const [t] = await tx
        .select({ id: tenants.id, name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
      return t
    }),
    listAccessibleTenants(),
  ])
  if (!tenant) redirect('/login')

  return (
    <AppShell
      ctx={{
        isSuperAdmin: ctx.isSuperAdmin,
        membership: ctx.membership,
        tenantId: tenant.id,
        tenantName: tenant.name,
      }}
      availableTenants={available}
    >
      {children}
    </AppShell>
  )
}
