import Link from 'next/link'
import { cn } from '@beaconhs/ui'

export type CorrectiveActionsSubNavKey =
  | 'records'
  | 'overdue'
  | 'by-source'
  | 'by-assignee'
  | 'aging'

const ITEMS: { key: CorrectiveActionsSubNavKey; label: string; href: string }[] = [
  { key: 'records', label: 'Records', href: '/corrective-actions' },
  { key: 'overdue', label: 'Overdue', href: '/corrective-actions/reports/overdue' },
  { key: 'by-source', label: 'By source', href: '/corrective-actions/reports/by-source' },
  { key: 'by-assignee', label: 'By assignee', href: '/corrective-actions/reports/by-assignee' },
  { key: 'aging', label: 'Aging', href: '/corrective-actions/reports/aging' },
]

/**
 * Strip of pill links shown at the top of every corrective-actions page so the
 * user can pivot between the master record list and the four roll-up reports
 * (overdue, by source, by assignee, aging buckets) without going home.
 */
export function CorrectiveActionsSubNav({ active }: { active: CorrectiveActionsSubNavKey }) {
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
