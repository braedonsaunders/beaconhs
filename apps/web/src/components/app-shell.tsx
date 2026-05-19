import Link from 'next/link'
import {
  Activity,
  AlertTriangle,
  Award,
  BellRing,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Gauge,
  GraduationCap,
  HardHat,
  Layers,
  ListChecks,
  MapPin,
  ShieldAlert,
  Settings,
  ShieldCheck,
  Timer,
  UserCircle2,
  Users,
  Wrench,
} from 'lucide-react'
import { Badge } from '@beaconhs/ui'
import { SignOutButton } from './sign-out-button'
import { TenantSwitcher } from './tenant-switcher'
import { NotificationsBell } from './notifications-bell'

type Ctx = {
  isSuperAdmin: boolean
  membership?: { displayName: string } | null
  tenantId: string
  tenantName: string
}

type NavItem = { href: string; label: string; icon: typeof Gauge }

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: Gauge },
      { href: '/notifications', label: 'Inbox', icon: BellRing },
    ],
  },
  {
    label: 'Frontline',
    items: [
      { href: '/forms', label: 'Forms', icon: ClipboardCheck },
      { href: '/inspections', label: 'Inspections', icon: ClipboardList },
      { href: '/inspections/banks', label: 'Inspection Banks', icon: Layers },
      { href: '/incidents', label: 'Incidents', icon: AlertTriangle },
      { href: '/corrective-actions', label: 'Corrective Actions', icon: ListChecks },
    ],
  },
  {
    label: 'Programs',
    items: [
      { href: '/training', label: 'Training', icon: GraduationCap },
      { href: '/training/authorities', label: 'Skill Authorities', icon: Award },
      { href: '/training/skills', label: 'Skills', icon: Activity },
      { href: '/documents', label: 'Documents', icon: BookOpen },
      { href: '/confined-space', label: 'Confined Space', icon: ShieldCheck },
      { href: '/confined-space/sensors', label: 'Atmospheric Sensors', icon: Activity },
      { href: '/lone-worker', label: 'Lone Worker', icon: Timer },
    ],
  },
  {
    label: 'Assets & people',
    items: [
      { href: '/people', label: 'People', icon: Users },
      { href: '/locations', label: 'Locations', icon: MapPin },
      { href: '/equipment', label: 'Equipment', icon: Wrench },
      { href: '/ppe', label: 'PPE', icon: HardHat },
    ],
  },
  {
    label: 'Insight',
    items: [{ href: '/reports', label: 'Reports', icon: FileText }],
  },
  {
    label: 'Settings',
    items: [{ href: '/admin', label: 'Admin', icon: Settings }],
  },
]

export function AppShell({
  ctx,
  availableTenants,
  unreadCount,
  children,
}: {
  ctx: Ctx
  availableTenants: { id: string; name: string; slug: string }[]
  unreadCount: number
  children: React.ReactNode
}) {
  const display = ctx.membership?.displayName ?? 'Account'
  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-teal-700 text-sm font-bold text-white">
            B
          </div>
          <span className="font-semibold tracking-tight">BeaconHS</span>
        </div>
        <nav className="app-scroll flex-1 overflow-y-auto px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </div>
              {group.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href as any}
                  className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                >
                  <item.icon size={15} className="text-slate-500" />
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3 text-xs text-slate-500">
          <div className="flex items-center justify-between">
            <span>v0.1.0</span>
            <Badge variant="secondary" className="font-mono text-[10px]">dev</Badge>
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

        <header className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
          <TenantSwitcher
            current={{ id: ctx.tenantId, name: ctx.tenantName }}
            available={availableTenants}
            isSuperAdmin={ctx.isSuperAdmin}
          />
          <div className="flex items-center gap-3 text-sm">
            <NotificationsBell unread={unreadCount} />
            <div className="hidden items-center gap-2 sm:flex">
              <UserCircle2 size={18} className="text-slate-500" />
              <span>{display}</span>
            </div>
            <SignOutButton />
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50">
          {children}
        </main>
      </div>
    </div>
  )
}
