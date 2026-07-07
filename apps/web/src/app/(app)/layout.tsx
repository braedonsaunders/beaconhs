import { Fragment } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { and, count, eq, isNull } from 'drizzle-orm'
import { Toaster } from 'sonner'
import { db, withSuperAdmin } from '@beaconhs/db'
import { notifications, tenants } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import {
  getRequestContext,
  getSessionUser,
  listAccessibleTenants,
  listActiveTenantRoles,
} from '@/lib/auth'
import { Suspense } from 'react'
import { AppShell } from '@/components/app-shell'
import { NavigationProvider } from '@/components/navigation-provider'
import { RiskMatrixProvider } from '@/components/risk-matrix'
import { BackNavProviders } from '@/components/smart-back-link'
import { ThemeProvider } from '@/components/theme-provider'
import { WalkthroughProvider } from '@/components/walkthrough/provider.client'
import { resolveNavGroups } from '@/lib/nav/resolve'
import { resolveWalkthroughs } from '@/lib/walkthroughs/service'

// Every page in the authenticated app shell requires the per-request context
// (auth + tenant + RLS-scoped DB), so none can be statically prerendered.
// Forcing dynamic at the layout level covers the whole (app) subtree — several
// pages omit their own `export const dynamic`, which broke `next build`.
export const dynamic = 'force-dynamic'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext()
  if (!ctx) redirect('/login')

  const defaultCollapsed = (await cookies()).get('sidebar_collapsed')?.value === '1'

  const [tenant, available, roles, unread, navGroups, sessionUser, walkthroughs] =
    await Promise.all([
    withSuperAdmin(db, async (tx) => {
      const [t] = await tx
        .select({ id: tenants.id, name: tenants.name, riskMatrix: tenants.riskMatrix })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .limit(1)
      return t
    }),
    listAccessibleTenants(),
    listActiveTenantRoles(),
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
    getSessionUser(),
    // Guided tours this user may launch + the first-run auto-start pick.
    ctx.db((tx) => resolveWalkthroughs(ctx, tx)),
  ])
  if (!tenant) redirect('/login')

  // The account menu shows the real signed-in account. Prefer the tenant display
  // name (consistent with the rest of the app), then the session name/email.
  const account = {
    name: ctx.membership?.displayName ?? sessionUser?.name ?? sessionUser?.email ?? 'Account',
    email: sessionUser?.email ?? '',
  }

  // The role the user is currently acting under: a single switched-into role, or
  // the union of all of them ("All roles"). The switcher itself hides when the
  // user has one role or fewer.
  const activeRole = ctx.activeRoleId
    ? { id: ctx.activeRoleId, name: roles.find((r) => r.id === ctx.activeRoleId)?.name ?? 'Role' }
    : { id: null, name: 'All roles' }

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
          account={account}
          groups={navGroups}
          availableTenants={available}
          availableRoles={roles}
          activeRole={activeRole}
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
          <RiskMatrixProvider matrix={tenant.riskMatrix}>
            <BackNavProviders>
              <Fragment key={`${ctx.tenantId}:${ctx.userId}:${ctx.activeRoleId ?? 'all'}`}>
                {children}
              </Fragment>
            </BackNavProviders>
          </RiskMatrixProvider>
          <Toaster richColors position="top-right" />
          {/* Suspense: the provider reads useSearchParams (tour launch links). */}
          <Suspense fallback={null}>
            <WalkthroughProvider
              availableIds={walkthroughs.visible.map((v) => v.walkthrough.id)}
              autoStartId={walkthroughs.autoStartId}
            />
          </Suspense>
        </AppShell>
      </NavigationProvider>
    </ThemeProvider>
  )
}
