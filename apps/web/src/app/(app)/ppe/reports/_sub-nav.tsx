// Second-level pill nav shown under the main PPE sub-nav on every
// /ppe/reports/* page. Lets reviewers pivot between the four canonical
// reports without going back to the top.

import Link from 'next/link'
import { cn } from '@beaconhs/ui'

export type ReportsSubNavKey = 'expired' | 'expiring' | 'by-person' | 'inspection-due'

const ITEMS: { key: ReportsSubNavKey; label: string; href: string }[] = [
  { key: 'expired', label: 'Expired', href: '/ppe/reports/expired' },
  { key: 'expiring', label: 'Expiring soon', href: '/ppe/reports/expiring' },
  { key: 'by-person', label: 'By person', href: '/ppe/reports/by-person' },
  { key: 'inspection-due', label: 'Inspection due', href: '/ppe/reports/inspection-due' },
]

export function ReportsSubNav({ active }: { active: ReportsSubNavKey }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-xs">
      {ITEMS.map((item) => {
        const isActive = item.key === active
        return (
          <Link
            key={item.key}
            href={item.href as any}
            className={cn(
              'inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
              isActive
                ? 'border-slate-800 bg-slate-800 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
