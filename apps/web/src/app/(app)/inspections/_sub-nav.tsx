// Internal sub-nav strip shared across every page under /inspections/**.
// Defined as a route-local file (underscore prefix keeps it out of routing)
// so it ships with the inspections module without polluting the shared
// components folder.

import Link from 'next/link'
import { cn } from '@beaconhs/ui'

export type InspectionsSubNavKey =
  | 'form-driven'
  | 'records'
  | 'types'
  | 'assignments'
  | 'banks'

const ITEMS: { key: InspectionsSubNavKey; label: string; href: string; description: string }[] = [
  {
    key: 'form-driven',
    label: 'Form-driven',
    href: '/inspections',
    description: 'Inspections backed by a form template.',
  },
  {
    key: 'records',
    label: 'Records',
    href: '/inspections/records',
    description: 'Criteria-based inspections (legacy parity).',
  },
  {
    key: 'types',
    label: 'Types',
    href: '/inspections/types',
    description: 'Admin: define the kinds of inspection.',
  },
  {
    key: 'assignments',
    label: 'Assignments',
    href: '/inspections/assignments',
    description: 'Who has to do which inspection how often.',
  },
  {
    key: 'banks',
    label: 'Banks',
    href: '/inspections/banks',
    description: 'Reusable criteria question banks.',
  },
]

export function InspectionsSubNav({ active }: { active: InspectionsSubNavKey }) {
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
