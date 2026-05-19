import Link from 'next/link'
import { cn } from '@beaconhs/ui'

export type ToolboxSubNavKey = 'records' | 'assignments' | 'transcripts'

const ITEMS: { key: ToolboxSubNavKey; label: string; href: string }[] = [
  { key: 'records', label: 'Records', href: '/toolbox' },
  { key: 'assignments', label: 'Assignments', href: '/toolbox/assignments' },
  { key: 'transcripts', label: 'Transcripts', href: '/toolbox/transcripts' },
]

/**
 * Strip of pill links shown at the top of every toolbox-suite page so the
 * user can pivot between journal records, recurring assignments, and the
 * per-person transcript explorer without going home.
 */
export function ToolboxSubNav({ active }: { active: ToolboxSubNavKey }) {
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
