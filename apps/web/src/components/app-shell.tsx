import Link from 'next/link'
import {
  AlertTriangle,
  BookOpen,
  ClipboardCheck,
  FileText,
  Gauge,
  GraduationCap,
  HardHat,
  ListChecks,
  ShieldAlert,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  Wrench,
} from 'lucide-react'
import { SignOutButton } from './sign-out-button'
import { TenantSwitcher } from './tenant-switcher'

type Ctx = {
  isSuperAdmin: boolean
  membership?: { displayName: string } | null
  tenantId: string
  tenantName: string
}

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: Gauge },
  { href: '/forms', label: 'Forms', icon: ClipboardCheck },
  { href: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { href: '/training', label: 'Training', icon: GraduationCap },
  { href: '/equipment', label: 'Equipment', icon: Wrench },
  { href: '/ppe', label: 'PPE', icon: HardHat },
  { href: '/documents', label: 'Documents', icon: BookOpen },
  { href: '/corrective-actions', label: 'Corrective Actions', icon: ListChecks },
  { href: '/people', label: 'People', icon: Users },
  { href: '/confined-space', label: 'Confined Space', icon: ShieldCheck },
  { href: '/reports', label: 'Reports', icon: FileText },
  { href: '/admin', label: 'Admin', icon: Settings },
] as const

export function AppShell({
  ctx,
  availableTenants,
  children,
}: {
  ctx: Ctx
  availableTenants: { id: string; name: string; slug: string }[]
  children: React.ReactNode
}) {
  const display = ctx.membership?.displayName ?? 'Account'
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
        <div className="flex h-14 items-center gap-2 border-b border-slate-200 px-4">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-teal-700 text-sm font-bold text-white">
            B
          </div>
          <span className="font-semibold">BeaconHS</span>
        </div>
        <nav className="p-2 text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href as any}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-slate-700 hover:bg-slate-100"
            >
              <item.icon size={16} />
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        {ctx.isSuperAdmin ? (
          <div className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-6 py-1.5 text-xs text-amber-900">
            <ShieldAlert size={14} />
            <span>
              Super-admin view · currently scoped to <strong>{ctx.tenantName}</strong>
            </span>
          </div>
        ) : null}
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <TenantSwitcher
            current={{ id: ctx.tenantId, name: ctx.tenantName }}
            available={availableTenants}
            isSuperAdmin={ctx.isSuperAdmin}
          />
          <div className="flex items-center gap-3 text-sm">
            <UserCircle2 size={18} className="text-slate-500" />
            <span>{display}</span>
            <SignOutButton />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
