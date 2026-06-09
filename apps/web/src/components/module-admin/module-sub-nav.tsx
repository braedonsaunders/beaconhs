// The single shared module sub-nav pill strip — replaces the ~10 bespoke
// per-module *-sub-nav.tsx copies. Renders operational tabs for everyone and,
// when the caller passes `manageHref` (i.e. the viewer may administer), appends
// a manager-only "Manage" pill. Dumb component: the server page decides what to
// pass (which tabs, whether a Manage pill).

import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import type { ModuleAdminTab } from '@/lib/module-admin/registry'

const PILL = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors'
const ACTIVE = 'border-teal-700 bg-teal-700 text-white'
const IDLE = 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'

export function ModuleSubNav({
  tabs,
  active,
  manageHref,
  manageActive,
}: {
  tabs: ModuleAdminTab[]
  active: string
  manageHref?: string
  manageActive?: boolean
}) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href as never} className={cn(PILL, t.key === active ? ACTIVE : IDLE)}>
          {t.label}
        </Link>
      ))}
      {manageHref ? (
        <Link href={manageHref as never} className={cn(PILL, manageActive ? ACTIVE : IDLE)}>
          <Settings2 size={12} /> Manage
        </Link>
      ) : null}
    </nav>
  )
}
