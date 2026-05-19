// Sub-nav strip shared across every page under /incidents/**.
// Defined as a route-local file (underscore prefix keeps it out of routing)
// so it ships with the incidents module without polluting the shared
// components folder — same pattern as /inspections/_sub-nav.tsx.

import Link from 'next/link'
import { cn } from '@beaconhs/ui'

export type IncidentsSubNavKey =
  | 'records'
  | 'classifications'
  | 'injury-types'
  | 'hours'
  | 'reports'

const ITEMS: { key: IncidentsSubNavKey; label: string; href: string; description: string }[] = [
  {
    key: 'records',
    label: 'Records',
    href: '/incidents',
    description: 'The incident log — reports, investigations, and closeouts.',
  },
  {
    key: 'classifications',
    label: 'Classifications',
    href: '/incidents/classifications',
    description: 'Admin: tenant-defined taxonomy used to bucket incidents.',
  },
  {
    key: 'injury-types',
    label: 'Injury types',
    href: '/incidents/injury-types',
    description: 'Admin: flat list of injury labels (laceration, strain, …).',
  },
  {
    key: 'hours',
    label: 'Hours',
    href: '/incidents/hours',
    description: 'Periodic hours-worked tally used by every frequency-rate report.',
  },
  {
    key: 'reports',
    label: 'Reports',
    href: '/incidents/reports/frequency',
    description: 'TRIR / DART / OSHA log / trend reports.',
  },
]

export function IncidentsSubNav({ active }: { active: IncidentsSubNavKey }) {
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
              'inline-flex items-center rounded-full border px-2.5 py-1 text-xs transition-colors',
              isActive
                ? 'border-teal-700 bg-teal-700 text-white'
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
