import Link from 'next/link'
import { cn } from '@beaconhs/ui'

// Path-segment tab strip for the unified compliance hub. (The shared TabNav is
// query-param driven; the hub uses real sub-routes, so this is a thin segment
// version with the same styling.)
const TABS = [
  { key: 'overview', label: 'Overview', href: '/compliance' },
  { key: 'obligations', label: 'Obligations', href: '/compliance/obligations' },
  { key: 'by-person', label: 'By person', href: '/compliance/by-person' },
  { key: 'aging', label: 'Aging', href: '/compliance/aging' },
  { key: 'expiring', label: 'Due & expiring', href: '/compliance/expiring' },
  { key: 'mine', label: 'Mine', href: '/compliance/mine' },
] as const

export type ComplianceTab = (typeof TABS)[number]['key']

export function ComplianceSubNav({ active }: { active: ComplianceTab }) {
  return (
    <nav
      className="flex flex-wrap items-center gap-1 border-b border-slate-200"
      role="tablist"
    >
      {TABS.map((t) => {
        const isActive = t.key === active
        return (
          <Link
            key={t.key}
            href={t.href}
            role="tab"
            aria-selected={isActive}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm',
              'transition-[color,border-color,background-color] duration-150 ease-out',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:rounded-t-md',
              isActive
                ? 'border-teal-700 font-medium text-teal-700'
                : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </nav>
  )
}
