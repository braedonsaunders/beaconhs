'use client'

// Library hub with subtabs (Cards | Dashboards) instead of stacked sections.

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { LayoutDashboard, Search } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { vizDef } from '@beaconhs/analytics'
import { VizIcon } from '../_viz/viz-icon'
import { PinButton } from './_pin-button.client'

export type LibraryCardItem = {
  id: string
  name: string
  description: string | null
  vizType: string
  status: 'draft' | 'published'
}
export type LibraryDashItem = { id: string; name: string; pinned: boolean }

export function LibraryTabs({
  cards,
  dashboards,
}: {
  cards: LibraryCardItem[]
  dashboards: LibraryDashItem[]
}) {
  const [tab, setTab] = useState<'cards' | 'dashboards'>('cards')
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const shownCards = useMemo(
    () =>
      needle
        ? cards.filter(
            (c) =>
              c.name.toLowerCase().includes(needle) ||
              (c.description ?? '').toLowerCase().includes(needle),
          )
        : cards,
    [cards, needle],
  )
  const shownDashboards = useMemo(
    () => (needle ? dashboards.filter((d) => d.name.toLowerCase().includes(needle)) : dashboards),
    [dashboards, needle],
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
          {(['cards', 'dashboards'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition',
                tab === t
                  ? 'bg-teal-600 text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {t}
              <span className="ml-1 tabular-nums opacity-60">
                {t === 'cards' ? cards.length : dashboards.length}
              </span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search
            size={14}
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${tab}…`}
            aria-label={`Search ${tab}`}
            className="h-9 w-full rounded-md border border-slate-300 bg-white pr-3 pl-8 text-sm text-slate-900 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </div>
      </div>

      {tab === 'cards' ? (
        shownCards.length === 0 ? (
          <Empty>{needle ? `No cards match “${query.trim()}”.` : 'No cards yet.'}</Empty>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shownCards.map((c) => (
              <Link
                key={c.id}
                href={`/insights/cards/${c.id}`}
                className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500/40"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
                  <VizIcon iconKey={vizDef(c.vizType)?.iconKey ?? 'Table'} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-100">
                    {c.name}
                  </div>
                  {c.description ? (
                    <div className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                      {c.description}
                    </div>
                  ) : null}
                </div>
                {c.status === 'published' ? (
                  <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                    Published
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        )
      ) : shownDashboards.length === 0 ? (
        <Empty>
          {needle ? `No dashboards match “${query.trim()}”.` : 'No published dashboards yet.'}
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shownDashboards.map((d) => (
            <div
              key={d.id}
              className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
                <LayoutDashboard size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {d.name}
                </div>
              </div>
              <PinButton dashboardId={d.id} pinned={d.pinned} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      {children}
    </div>
  )
}
