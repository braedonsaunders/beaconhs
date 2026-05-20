import { redirect } from 'next/navigation'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { Toaster } from 'sonner'
import { db } from '@beaconhs/db'
import { notifications, tenants } from '@beaconhs/db/schema'
import { getRequestContext, listAccessibleTenants } from '@/lib/auth'
import { AppShell } from '@/components/app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext()
  if (!ctx) redirect('/login')

  const [tenant, available, unread] = await Promise.all([
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
    ctx.db(async (tx) => {
      const [row] = await tx
        .select({ c: count() })
        .from(notifications)
        .where(and(eq(notifications.userId, ctx.userId), isNull(notifications.readAt)))
      return Number(row?.c ?? 0)
    }),
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
      unreadCount={unread}
    >
      {children}
      <Toaster richColors position="top-right" />
    </AppShell>
  )
}
