import Link from 'next/link'
import { cn } from '@beaconhs/ui'

export type PpeSubNavKey =
  | 'records'
  | 'types'
  | 'inspection-criteria'
  | 'issue'
  | 'reports'

const ITEMS: { key: PpeSubNavKey; label: string; href: string }[] = [
  { key: 'records', label: 'Records', href: '/ppe' },
  { key: 'types', label: 'Types', href: '/ppe/types' },
  { key: 'inspection-criteria', label: 'Inspection criteria', href: '/ppe/inspection-criteria' },
  { key: 'issue', label: 'Issue', href: '/ppe/issue' },
  { key: 'reports', label: 'Reports', href: '/ppe/reports/expired' },
]

/**
 * Strip of pill links shown at the top of every PPE-suite page so the user can
 * pivot between the asset register, the per-type admin (with sub-tabs for
 * general / criteria / sizing), the criteria-overview admin, the issuance
 * dashboard, and the reports gallery without bouncing through the home page.
 *
 * Legacy parity: the legacy app exposed the same top-level navigation as the
 * `pages/ppe/records|types|issues|inspections|reports` Blade files; the
 * "inspection-criteria" pill is a modern roll-up that the legacy UI lacked.
 */
export function PpeSubNav({ active }: { active: PpeSubNavKey }) {
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
