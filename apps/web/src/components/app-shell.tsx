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
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  Wrench,
} from 'lucide-react'
import { SignOutButton } from './sign-out-button'

type Ctx = { isSuperAdmin: boolean; membership?: { displayName: string } | null }

const NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: Gauge, perm: null },
  { href: '/forms', label: 'Forms', icon: ClipboardCheck, perm: null },
  { href: '/incidents', label: 'Incidents', icon: AlertTriangle, perm: null },
  { href: '/training', label: 'Training', icon: GraduationCap, perm: null },
  { href: '/equipment', label: 'Equipment', icon: Wrench, perm: null },
  { href: '/ppe', label: 'PPE', icon: HardHat, perm: null },
  { href: '/documents', label: 'Documents', icon: BookOpen, perm: null },
  { href: '/corrective-actions', label: 'Corrective Actions', icon: ListChecks, perm: null },
  { href: '/people', label: 'People', icon: Users, perm: null },
  { href: '/confined-space', label: 'Confined Space', icon: ShieldCheck, perm: null },
  { href: '/reports', label: 'Reports', icon: FileText, perm: null },
  { href: '/admin', label: 'Admin', icon: Settings, perm: null },
] as const

export function AppShell({ ctx, children }: { ctx: Ctx; children: React.ReactNode }) {
  const display = ctx.membership?.displayName ?? (ctx.isSuperAdmin ? 'Super Admin' : 'Account')
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
        <header className="flex h-14 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="text-sm text-slate-500">{ctx.isSuperAdmin ? 'Super admin' : 'Tenant'}</div>
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
