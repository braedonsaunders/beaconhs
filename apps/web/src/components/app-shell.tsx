import { ShieldAlert, UserCircle2 } from 'lucide-react'
import { SignOutButton } from './sign-out-button'
import { TenantSwitcher } from './tenant-switcher'
import { NotificationsBell } from './notifications-bell'
import { GlobalSearch } from './global-search'
import { type SidebarNavGroup } from './sidebar-nav'
import { AppSidebar } from './app-sidebar'
import { MobileNavToggle } from './mobile-nav-toggle'

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
  children: React.ReactNode
}) {
  const display = ctx.membership?.displayName ?? 'Account'
  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar groups={groups} defaultCollapsed={defaultCollapsed} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {ctx.isSuperAdmin ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-300 bg-amber-50 px-6 py-1 text-xs text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            <ShieldAlert size={14} />
            <span>
              Super-admin · scoped to <strong>{ctx.tenantName}</strong>
            </span>
          </div>
        ) : null}

        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:gap-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
          <MobileNavToggle groups={groups} />
          <TenantSwitcher
            current={{ id: ctx.tenantId, name: ctx.tenantName }}
            available={availableTenants}
            isSuperAdmin={ctx.isSuperAdmin}
          />
          <div className="hidden flex-1 justify-center md:flex">
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-3 text-sm">
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
      </div>
    </div>
  )
}
