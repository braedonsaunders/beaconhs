// Reusable admin tile grid — generalized from the static tiles on /admin
// (admin/page.tsx). Renders a set of registry-driven sections as cards. Used by
// the per-module Manage hub and the global /admin module-administration rollup.

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { NavIcon } from '@/components/sidebar-nav'

export type AdminTile = {
  key: string
  label: string
  href: string
  iconKey: string
  desc: string
  badge?: string
}

export function AdminTileGrid({ tiles }: { tiles: AdminTile[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((t) => (
        <Link
          key={t.key}
          href={t.href as never}
          className={cn(
            'group relative block overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900',
            'transition-all duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-md',
          )}
        >
          <NavIcon
            iconKey={t.iconKey}
            size={112}
            className="pointer-events-none absolute -right-4 -bottom-5 text-teal-500 opacity-[0.07] transition-opacity duration-200 group-hover:opacity-[0.12]"
          />
          <div className="relative flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-100 dark:bg-teal-950/50 dark:text-teal-300">
              <NavIcon iconKey={t.iconKey} size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">{t.label}</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t.desc}</p>
            </div>
          </div>
          <span className="relative mt-4 inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors group-hover:text-teal-700 dark:text-slate-500">
            Open
            <ArrowUpRight
              size={13}
              className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            />
          </span>
        </Link>
      ))}
    </div>
  )
}
