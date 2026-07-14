'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@beaconhs/ui'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { setStationBaseLocation } from './_actions'

const BASE_PATH = '/equipment/station/settings'

type StationBaseLocationRow = {
  id: string
  name: string
  code: string | null
  level: string
  isBase: boolean
}

export function StationBaseLocationsManager({
  rows,
  total,
  page,
  perPage,
  currentParams,
}: {
  rows: StationBaseLocationRow[]
  total: number
  page: number
  perPage: number
  currentParams: Record<string, string | string[] | undefined>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function update(row: StationBaseLocationRow, isBase: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await setStationBaseLocation({ id: row.id, isBase })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="max-w-3xl space-y-3 border-t border-slate-200 pt-6 dark:border-slate-800">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Locations that count as “checked in”
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Assets at a selected shop, yard, or crib are reported as at base. Each checkbox saves
          immediately; changing one page never clears selections on another page.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          paramKey="baseQ"
          pageParamKey="basePage"
          placeholder="Search location name or code…"
        />
        <FilterChips
          basePath={BASE_PATH}
          currentParams={currentParams}
          paramKey="baseState"
          pageParamKey="basePage"
          label="Base status"
          allLabel="All locations"
          options={[
            { value: 'base', label: 'At base' },
            { value: 'other', label: 'Not at base' },
          ]}
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          {total.toLocaleString()} matching location{total === 1 ? '' : 's'}
        </span>
      </div>

      <div className="max-w-2xl divide-y overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {rows.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-slate-400">
            No locations match this search and filter.
          </div>
        ) : (
          rows.map((row) => (
            <label
              key={row.id}
              className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50"
            >
              <input
                type="checkbox"
                checked={row.isBase}
                disabled={pending}
                onChange={(event) => update(row, event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-50"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-800 dark:text-slate-200">
                  {row.name}
                </span>
                <span className="block truncate text-xs text-slate-400">
                  {[row.level, row.code].filter(Boolean).join(' · ')}
                </span>
              </span>
              {row.isBase ? <Badge variant="success">At base</Badge> : null}
            </label>
          ))
        )}
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
      {pending ? <p className="text-xs text-slate-500">Saving base location…</p> : null}
      <Pagination
        basePath={BASE_PATH}
        currentParams={currentParams}
        total={total}
        page={page}
        perPage={perPage}
        pageParamKey="basePage"
      />
    </section>
  )
}
