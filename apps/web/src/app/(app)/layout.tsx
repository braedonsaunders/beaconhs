import { Fragment } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { Toaster } from 'sonner'
import { db } from '@beaconhs/db'
import { notifications, tenants } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { getRequestContext, listAccessibleTenants } from '@/lib/auth'
import { AppShell } from '@/components/app-shell'
import { NavigationProvider } from '@/components/navigation-provider'
import { ThemeProvider } from '@/components/theme-provider'
import { resolveNavGroups } from '@/lib/nav/resolve'

// Every page in the authenticated app shell requires the per-request context
// (auth + tenant + RLS-scoped DB), so none can be statically prerendered.
// Forcing dynamic at the layout level covers the whole (app) subtree — several
// pages omit their own `export const dynamic`, which broke `next build`.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext()
  if (!ctx) redirect('/login')

  const defaultCollapsed = (await cookies()).get('sidebar_collapsed')?.value === '1'

  const [tenant, available, unread, navGroups] = await Promise.all([
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
    // Build the sidebar from the registry + this tenant's saved nav config,
    // filtered to what this user is permitted to open.
    ctx.db((tx) => resolveNavGroups(ctx, tx)),
  ])
  if (!tenant) redirect('/login')

  // While impersonating, ctx is already the TARGET (membership = their display
  // name); ctx.impersonation carries the real admin for the banner.
  const impersonation = ctx.impersonation
    ? {
        actorName: ctx.impersonation.actor.name,
        targetName: ctx.membership?.displayName ?? 'this user',
        expiresAtMs: ctx.impersonation.expiresAt.getTime(),
      }
    : null

  return (
    <ThemeProvider>
      <NavigationProvider>
        <AppShell
          ctx={{
            isSuperAdmin: ctx.isSuperAdmin,
            membership: ctx.membership,
            tenantId: tenant.id,
            tenantName: tenant.name,
          }}
          groups={navGroups}
          availableTenants={available}
          unreadCount={unread}
          defaultCollapsed={defaultCollapsed}
          impersonation={impersonation}
          canUseAssistant={can(ctx, 'assistant.use')}
        >
          {/* Remount the page subtree when the active tenant — or effective
              user, while impersonating — changes. router.refresh() (fired by the
              tenant switcher) re-renders server components but PRESERVES client
              state across the refresh, so any 'use client' page that seeds
              useState from server props (nav editor, edit forms, filter UIs)
              would keep showing the previous tenant's values. Keying here resets
              that whole class of state in one place; the shell/sidebar stay
              mounted and update via fresh props as before. */}
          <Fragment key={`${ctx.tenantId}:${ctx.userId}`}>{children}</Fragment>
          <Toaster richColors position="top-right" />
        </AppShell>
      </NavigationProvider>
    </ThemeProvider>
  )
}
