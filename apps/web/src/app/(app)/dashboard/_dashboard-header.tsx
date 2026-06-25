// Dashboard header: a plain, typographic greeting + tenant summary, with the
// Customise action on the right. Deliberately understated — the card grid
// below carries the visual weight, so the header stays out of the way.

import Link from 'next/link'
import { Settings2 } from 'lucide-react'

export function DashboardHeader({
  greeting,
  tenantSummary,
}: {
  greeting: string
  /** Org rollup ("N people · M incidents"); omitted for self-only viewers. */
  tenantSummary?: string | null
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {greeting}
        </h1>
        {tenantSummary ? (
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{tenantSummary}</p>
        ) : null}
      </div>
      <Link
        href="/dashboard/customize"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <Settings2 size={14} />
        Customise
      </Link>
    </header>
  )
}
