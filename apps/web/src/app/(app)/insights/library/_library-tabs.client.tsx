'use client'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'

import { useGeneratedTranslations } from '@/i18n/generated'

// Library hub with subtabs (Cards | Dashboards) instead of stacked sections.

import Link from 'next/link'
import { FileText, LayoutDashboard } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { vizDef } from '@beaconhs/analytics'
import { VizIcon } from '../_viz/viz-icon'
import { PinButton } from './_pin-button.client'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { mergeHref } from '@/lib/list-params'

type LibraryCardItem = {
  id: string
  name: string
  description: string | null
  vizType: string
  status: 'draft' | 'published'
}
type LibraryDashItem = { id: string; name: string; pinned: boolean }

export function LibraryTabs({
  cards,
  dashboards,
  canExport,
  tab,
  query,
  page,
  perPage,
  total,
  cardCount,
  dashboardCount,
  currentParams,
}: {
  cards: LibraryCardItem[]
  dashboards: LibraryDashItem[]
  canExport: boolean
  tab: 'cards' | 'dashboards'
  query: string
  page: number
  perPage: number
  total: number
  cardCount: number
  dashboardCount: number
  currentParams: Record<string, string | string[] | undefined>
}) {
  const tGenerated = useGeneratedTranslations()

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5 dark:border-slate-800">
          <GeneratedValue
            value={(['cards', 'dashboards'] as const).map((t) => (
              <Link
                key={t}
                href={mergeHref('/insights/library', currentParams, { tab: t, page: 1 })}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium capitalize transition',
                  tab === t
                    ? 'bg-teal-600 text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                <GeneratedValue value={t} />
                <span className="ml-1 tabular-nums opacity-60">
                  <GeneratedValue value={t === 'cards' ? cardCount : dashboardCount} />
                </span>
              </Link>
            ))}
          />
        </div>
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
          <GeneratedValue
            value={
              tab === 'cards' ? (
                <FilterChips
                  basePath="/insights/library"
                  currentParams={currentParams}
                  paramKey="status"
                  label={tGenerated('m_0b9da892d6faf0')}
                  allLabel="All statuses"
                  options={[
                    { value: 'published', label: 'Published' },
                    { value: 'draft', label: 'Draft' },
                  ]}
                />
              ) : null
            }
          />
          <SearchInput placeholder={tGenerated('m_1f0a8c50aedb8c', { value0: tab })} />
        </div>
      </div>

      <GeneratedValue
        value={
          tab === 'cards' ? (
            total === 0 ? (
              <Empty>
                <GeneratedValue
                  value={
                    query ? (
                      <GeneratedText id="m_161a011e2a0efa" values={{ value0: query }} />
                    ) : (
                      <GeneratedText id="m_1a1eef4e7913c3" />
                    )
                  }
                />
              </Empty>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <GeneratedValue
                  value={cards.map((c) => (
                    <div
                      key={c.id}
                      className="group relative flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-teal-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-500/40"
                    >
                      <Link
                        href={`/insights/cards/${c.id}`}
                        aria-label={tGenerated('m_07f6f328b6cf6a', { value0: c.name })}
                        className="absolute inset-0 rounded-xl"
                      />
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
                        <VizIcon iconKey={vizDef(c.vizType)?.iconKey ?? 'Table'} size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800 group-hover:text-teal-700 dark:text-slate-100">
                          <GeneratedValue value={c.name} />
                        </div>
                        <GeneratedValue
                          value={
                            c.description ? (
                              <div className="line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                                <GeneratedValue value={c.description} />
                              </div>
                            ) : null
                          }
                        />
                      </div>
                      <GeneratedValue
                        value={
                          c.status === 'published' ? (
                            <span className="shrink-0 rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                              <GeneratedText id="m_0a65097103ae1b" />
                            </span>
                          ) : null
                        }
                      />
                      <GeneratedValue
                        value={
                          canExport ? (
                            <a
                              href={`/insights/cards/${c.id}/export?format=pdf`}
                              className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-teal-700 focus:ring-2 focus:ring-teal-500/30 focus:outline-none dark:hover:bg-slate-800 dark:hover:text-teal-300"
                              aria-label={tGenerated('m_13928c678297eb', { value0: c.name })}
                              title={tGenerated('m_1e5ece8eefa44b')}
                            >
                              <FileText size={14} />
                            </a>
                          ) : null
                        }
                      />
                    </div>
                  ))}
                />
              </div>
            )
          ) : total === 0 ? (
            <Empty>
              <GeneratedValue
                value={
                  query ? (
                    <GeneratedText id="m_12785264ffab7f" values={{ value0: query }} />
                  ) : (
                    <GeneratedText id="m_16b77ccf090fe8" />
                  )
                }
              />
            </Empty>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <GeneratedValue
                value={dashboards.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-300">
                      <LayoutDashboard size={17} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                        <GeneratedValue value={d.name} />
                      </div>
                    </div>
                    <PinButton dashboardId={d.id} pinned={d.pinned} />
                  </div>
                ))}
              />
            </div>
          )
        }
      />
      <Pagination
        basePath="/insights/library"
        currentParams={currentParams}
        total={total}
        page={page}
        perPage={perPage}
      />
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
      <GeneratedValue value={children} />
    </div>
  )
}
