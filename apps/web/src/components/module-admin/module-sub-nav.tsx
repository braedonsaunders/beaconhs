// The single shared module sub-nav pill strip — replaces the ~10 bespoke
// per-module *-sub-nav.tsx copies. Renders an optional back pill (admin pages
// navigating up to the module home), the tabs, and — when the caller passes
// `manageHref` (i.e. the viewer may administer) — a manager-only "Manage" pill.
// Dumb component: the server page decides what to pass.

import Link from 'next/link'
import { ChevronLeft, Settings2 } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import type { ModuleAdminTab } from '@/lib/module-admin/registry'

const PILL =
  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap transition-colors'
const ACTIVE = 'border-teal-700 bg-teal-700 text-white'
const IDLE =
  'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'

export function ModuleSubNav({
  tabs,
  active,
  back,
  manageHref,
  manageActive,
}: {
  tabs: ModuleAdminTab[]
  active: string
  /** Up-navigation pill rendered before the tabs (e.g. admin page → module home). */
  back?: { href: string; label: string }
  manageHref?: string
  manageActive?: boolean
}) {
  return (
    <nav className="flex [scrollbar-width:none] flex-nowrap items-center gap-1.5 overflow-x-auto [-ms-overflow-style:none] sm:flex-wrap sm:overflow-x-visible [&::-webkit-scrollbar]:hidden">
      {back ? (
        <Link href={back.href as never} className={cn(PILL, IDLE)}>
          <ChevronLeft size={12} /> {back.label}
        </Link>
      ) : null}
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href as never}
          className={cn(PILL, t.key === active ? ACTIVE : IDLE)}
        >
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
