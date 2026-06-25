import { ShieldAlert, UserCircle2 } from 'lucide-react'
import { SignOutButton } from './sign-out-button'
import { TenantSwitcher } from './tenant-switcher'
import { PlatformMenu } from './platform-menu'
import { NotificationsBell } from './notifications-bell'
import { GlobalSearch } from './global-search'
import { type SidebarNavGroup } from './sidebar-nav'
import { AppSidebar } from './app-sidebar'
import { MobileNavProvider } from './mobile-nav'
import { MobileNavToggle } from './mobile-nav-toggle'
import { MobileTabBar } from './mobile-tab-bar'
import { ServiceWorkerRegistrar } from './service-worker-registrar'
import { ImpersonationBanner } from './impersonation-banner'

type Ctx = {
  isSuperAdmin: boolean
  membership?: { displayName: string } | null
  tenantId: string
  tenantName: string
}

export function AppShell({
  ctx,
  groups,
  availableTenants,
  unreadCount,
  defaultCollapsed = false,
  impersonation = null,
  children,
}: {
  ctx: Ctx
  // Resolved server-side from the module registry + the tenant's saved nav
  // config, already filtered to what this user may open. See
  // apps/web/src/lib/nav/resolve.ts.
  groups: SidebarNavGroup[]
  availableTenants: { id: string; name: string; slug: string }[]
  unreadCount: number
  /** Persisted sidebar-collapsed preference (from the `sidebar_collapsed` cookie). */
  defaultCollapsed?: boolean
  /** Set only while this request is impersonating — drives the global banner. */
  impersonation?: { actorName: string; targetName: string; expiresAtMs: number } | null
  children: React.ReactNode
}) {
  const display = ctx.membership?.displayName ?? 'Account'
  return (
    <div className="flex h-screen overflow-hidden">
      <ServiceWorkerRegistrar unreadCount={unreadCount} />
      <AppSidebar groups={groups} defaultCollapsed={defaultCollapsed} />

      <MobileNavProvider>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden [padding-top:env(safe-area-inset-top)]">
          {impersonation ? (
            <ImpersonationBanner
              actorName={impersonation.actorName}
              targetName={impersonation.targetName}
              expiresAtMs={impersonation.expiresAtMs}
            />
          ) : null}
          {ctx.isSuperAdmin ? (
            <div className="flex shrink-0 items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-1 text-xs text-amber-900 sm:px-6 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
              <ShieldAlert size={14} className="shrink-0" />
              <span className="truncate">
                Super-admin · scoped to <strong>{ctx.tenantName}</strong>
              </span>
            </div>
          ) : null}

          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 sm:gap-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
            <MobileNavToggle groups={groups} />
            <TenantSwitcher
              current={{ id: ctx.tenantId, name: ctx.tenantName }}
              available={availableTenants}
              isSuperAdmin={ctx.isSuperAdmin}
            />
            {ctx.isSuperAdmin ? <PlatformMenu /> : null}
            <div className="hidden flex-1 justify-center md:flex">
              <GlobalSearch />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 text-sm sm:gap-3 md:ml-0">
              <NotificationsBell unread={unreadCount} />
              <div className="hidden items-center gap-2 sm:flex">
                <UserCircle2 size={18} className="text-slate-500 dark:text-slate-400" />
                <span className="text-slate-700 dark:text-slate-200">{display}</span>
              </div>
              <SignOutButton />
            </div>
          </header>

          <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
            {children}
          </main>

          <MobileTabBar groups={groups} />
        </div>
      </MobileNavProvider>
    </div>
  )
}
