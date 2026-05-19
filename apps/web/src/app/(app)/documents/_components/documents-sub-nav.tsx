import Link from 'next/link'
import { cn } from '@beaconhs/ui'

type NavKey =
  | 'documents'
  | 'books'
  | 'reference'
  | 'assignments'
  | 'management-reviews'
  | 'types'
  | 'categories'

const ITEMS: { key: NavKey; href: string; label: string }[] = [
  { key: 'documents', href: '/documents', label: 'Documents' },
  { key: 'books', href: '/documents/books', label: 'Books' },
  { key: 'reference', href: '/documents/reference', label: 'Reference' },
  { key: 'assignments', href: '/documents/assignments', label: 'Assignments' },
  {
    key: 'management-reviews',
    href: '/documents/management-reviews',
    label: 'Management reviews',
  },
  { key: 'types', href: '/documents/types', label: 'Types' },
  { key: 'categories', href: '/documents/categories', label: 'Categories' },
]

/**
 * Cross-page sub-nav for the Documentation module. Used on every list-level
 * page so the user can hop between Documents / Books / Reference / Assignments
 * / Management reviews / Types / Categories without reaching for the
 * primary sidebar.
 */
export function DocumentsSubNav({ active }: { active: NavKey }) {
  return (
    <nav className="flex flex-wrap items-center gap-2">
      {ITEMS.map((item) => {
        const isActive = item.key === active
        return (
          <Link
            key={item.key}
            href={item.href as any}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'border-teal-500 bg-teal-50 text-teal-700'
                : 'border-slate-200 text-slate-600 hover:border-teal-500 hover:bg-teal-50 hover:text-teal-700',
            )}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
