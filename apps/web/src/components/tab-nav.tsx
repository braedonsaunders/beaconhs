import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@beaconhs/ui'
import { mergeHref } from '@/lib/list-params'

export type TabDef = {
  key: string
  label: string
  count?: number
  hidden?: boolean
  /** Optional icon; shown instead of the label when the nav is `iconOnly`. */
  icon?: ReactNode
}

/**
 * URL-driven tabs. The active tab is read from a search param (default 'tab').
 * Each tab is a link that preserves other query params.
 *
 * Visual touches:
 *   • 2px teal underline for the active tab, springy on hover with a
 *     transparent-to-slate fade for inactive tabs
 *   • count pill picks up the teal palette when its tab is active
 *   • tab body should be wrapped in `<TabContent>` (from @beaconhs/ui) so
 *     content crossfades between selections.
 */
export function TabNav({
  basePath,
  currentParams,
  tabs,
  active,
  paramKey = 'tab',
  className,
  iconOnly = false,
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  tabs: TabDef[]
  active: string
  paramKey?: string
  className?: string
  /** Render the per-tab icon instead of its label (label becomes the tooltip). */
  iconOnly?: boolean
}) {
  return (
    <nav
      className={cn(
        'flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800',
        className,
      )}
      role="tablist"
    >
      {tabs
        .filter((t) => !t.hidden)
        .map((t) => {
          const isActive = t.key === active
          const href = mergeHref(basePath, currentParams, { [paramKey]: t.key })
          return (
            <Link
              key={t.key}
              href={href as any}
              role="tab"
              aria-selected={isActive}
              title={iconOnly && t.icon ? t.label : undefined}
              aria-label={iconOnly && t.icon ? t.label : undefined}
              className={cn(
                '-mb-px inline-flex items-center gap-1.5 border-b-2 py-2 text-sm',
                iconOnly && t.icon ? 'px-2.5' : 'px-3',
                'transition-[color,border-color,background-color] duration-150 ease-out',
                'focus-visible:rounded-t-md focus-visible:ring-2 focus-visible:ring-teal-500/40 focus-visible:outline-none',
                isActive
                  ? 'border-teal-700 font-medium text-teal-700 dark:text-teal-300'
                  : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-slate-100',
              )}
            >
              {iconOnly && t.icon ? t.icon : t.label}
              {typeof t.count === 'number' ? (
                <span
                  className={cn(
                    'rounded-full px-1.5 py-0.5 text-xs leading-none transition-colors duration-150',
                    isActive
                      ? 'bg-teal-100 text-teal-900 dark:text-teal-300'
                      : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                  )}
                >
                  {t.count}
                </span>
              ) : null}
            </Link>
          )
        })}
    </nav>
  )
}

export function pickActiveTab<T extends string>(
  search: Record<string, string | string[] | undefined>,
  tabs: readonly T[],
  fallback: T,
  paramKey = 'tab',
): T {
  const raw = typeof search[paramKey] === 'string' ? (search[paramKey] as string) : undefined
  return raw && (tabs as readonly string[]).includes(raw) ? (raw as T) : fallback
}
