import { ShieldAlert, UserCircle2 } from 'lucide-react'
import { Badge } from '@beaconhs/ui'
import { SignOutButton } from './sign-out-button'
import { TenantSwitcher } from './tenant-switcher'
import { NotificationsBell } from './notifications-bell'
import { GlobalSearch } from './global-search'
import { SidebarNav, type SidebarNavGroup } from './sidebar-nav'
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
  children,
}: {
  ctx: Ctx
  // Resolved server-side from the module registry + the tenant's saved nav
  // config, already filtered to what this user may open. See
  // apps/web/src/lib/nav/resolve.ts.
  groups: SidebarNavGroup[]
  availableTenants: { id: string; name: string; slug: string }[]
  unreadCount: number
  children: React.ReactNode
}) {
  const display = ctx.membership?.displayName ?? 'Account'
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-teal-600 to-teal-800 text-sm font-bold text-white shadow-sm ring-1 ring-teal-900/10">
            B
          </div>
          <span className="font-semibold tracking-tight text-slate-900">BeaconHS</span>
        </div>
        <SidebarNav groups={groups} />
        <div className="border-t border-slate-200 p-3 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span>v0.1.0</span>
            <Badge variant="secondary" className="font-mono text-[10px]">
              dev
            </Badge>
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        {ctx.isSuperAdmin ? (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-300 bg-amber-50 px-6 py-1 text-xs text-amber-900">
            <ShieldAlert size={14} />
            <span>
              Super-admin · scoped to <strong>{ctx.tenantName}</strong>
            </span>
          </div>
        ) : null}

        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:gap-4 sm:px-6">
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
              <UserCircle2 size={18} className="text-slate-500" />
              <span>{display}</span>
            </div>
            <SignOutButton />
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">{children}</main>
      </div>
    </div>
  )
}
