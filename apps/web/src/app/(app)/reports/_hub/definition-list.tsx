// Left pane of the reports hub — the category-grouped catalogue of every
// report the tenant can run. Selection is URL-driven (?selected=) so the
// preview pane is a pure server render and deep links / refresh work.

import Link from 'next/link'
import { Badge, EmptyState, cn } from '@beaconhs/ui'
import { FileText } from 'lucide-react'
import type { ReportDefinitionRow } from '../_definitions'

/** Build a /reports href from the hub's URL params, dropping empty ones. */
export function hubHref(params: Record<string, string | null | undefined>): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
  const s = qs.toString()
  return s ? `/reports?${s}` : '/reports'
}

export function DefinitionList({
  sections,
  selectedId,
  listParams,
  totalAll,
}: {
  /** Category → definitions, already filtered by search/kind/category. */
  sections: [string, ReportDefinitionRow[]][]
  selectedId: string | null
  /** Current q/kind/category params, preserved on every row link. */
  listParams: Record<string, string | undefined>
  totalAll: number
}) {
  if (sections.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<FileText size={24} />}
          title={totalAll === 0 ? 'No reports available' : 'No matching reports'}
          description={
            totalAll === 0 ? 'Create a report to get started.' : 'Adjust the search or filters.'
          }
        />
      </div>
    )
  }

  return (
    <nav aria-label="Reports" className="pb-4">
      {sections.map(([cat, defs]) => (
        <section key={cat}>
          <h2 className="sticky top-0 z-10 border-b border-slate-100 bg-white px-3 py-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase sm:px-4 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            {cat.replace(/_/g, ' ')}{' '}
            <span className="font-normal text-slate-400">({defs.length})</span>
          </h2>
          <ul>
            {defs.map((d) => {
              const active = d.id === selectedId
              return (
                <li key={d.id}>
                  <Link
                    href={hubHref({ ...listParams, selected: d.id }) as never}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'block border-l-2 px-3 py-2 transition-colors sm:px-4',
                      active
                        ? 'border-teal-600 bg-teal-50/70 dark:border-teal-400 dark:bg-teal-500/10'
                        : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={cn(
                          'truncate text-sm font-medium',
                          active
                            ? 'text-teal-900 dark:text-teal-100'
                            : 'text-slate-900 dark:text-slate-100',
                        )}
                      >
                        {d.name}
                      </span>
                      {d.kind === 'custom' ? <Badge variant="secondary">custom</Badge> : null}
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
                      {d.description ?? 'No description.'}
                    </p>
                  </Link>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </nav>
  )
}
