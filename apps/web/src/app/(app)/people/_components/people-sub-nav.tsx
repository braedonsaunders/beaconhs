import Link from 'next/link'
import { cn } from '@beaconhs/ui'

// Top-of-page tabs for the people admin areas (Groups / Divisions / Titles)
// plus the catch-all People directory. Rendered as a horizontal pill nav so
// it matches the toolbox-sub-nav / equipment-sub-nav components.

export type PeopleNavSection =
  | 'directory'
  | 'org-chart'
  | 'groups'
  | 'divisions'
  | 'titles'

export function PeopleSubNav({ active }: { active: PeopleNavSection }) {
  const items: { key: PeopleNavSection; label: string; href: string }[] = [
    { key: 'directory', label: 'Directory', href: '/people' },
    { key: 'org-chart', label: 'Org chart', href: '/people/org-chart' },
    { key: 'groups', label: 'Groups', href: '/people/groups' },
    { key: 'divisions', label: 'Divisions', href: '/people/divisions' },
    { key: 'titles', label: 'Titles', href: '/people/titles' },
  ]
  return (
    <nav className="flex flex-wrap items-center gap-1 border-b border-slate-200">
      {items.map((it) => {
        const isActive = it.key === active
        return (
          <Link
            key={it.key}
            href={it.href as any}
            className={cn(
              '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
              isActive
                ? 'border-teal-700 font-medium text-teal-700'
                : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
            )}
          >
            {it.label}
          </Link>
        )
      })}
    </nav>
  )
}
