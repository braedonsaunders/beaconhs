// Sub-sub-nav for the four report pages — sits just under the main
// incidents sub-nav.

import Link from 'next/link'
import { cn } from '@beaconhs/ui'

export type ReportsSubNavKey = 'frequency' | 'severity' | 'osha-log' | 'trends'

const ITEMS: { key: ReportsSubNavKey; label: string; href: string; description: string }[] = [
  {
    key: 'frequency',
    label: 'Frequency rate',
    href: '/incidents/reports/frequency',
    description: 'TRIR per month / quarter using OSHA formula.',
  },
  {
    key: 'severity',
    label: 'Severity (DART)',
    href: '/incidents/reports/severity',
    description: 'Days-away / restricted / transferred per period.',
  },
  {
    key: 'osha-log',
    label: 'OSHA 300 log',
    href: '/incidents/reports/osha-log',
    description: 'OSHA-300-style log of recordable incidents.',
  },
  {
    key: 'trends',
    label: 'Trends',
    href: '/incidents/reports/trends',
    description: 'Monthly counts split by type / severity.',
  },
]

export function IncidentReportsSubNav({ active }: { active: ReportsSubNavKey }) {
  return (
    <nav className="flex flex-wrap items-center gap-1.5 text-xs">
      {ITEMS.map((item) => {
        const isActive = item.key === active
        return (
          <Link
            key={item.key}
            href={item.href as any}
            title={item.description}
            className={cn(
              'inline-flex items-center rounded-md border px-2 py-1 text-xs transition-colors',
              isActive
                ? 'border-slate-700 bg-slate-700 text-white'
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
