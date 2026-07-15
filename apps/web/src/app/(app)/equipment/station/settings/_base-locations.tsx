'use client'

import {
  GeneratedText,
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

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
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function update(row: StationBaseLocationRow, isBase: boolean) {
    setError(tGeneratedValue(null))
    startTransition(async () => {
      const result = await setStationBaseLocation({ id: row.id, isBase })
      if (!result.ok) {
        setError(tGeneratedValue(result.error))
        return
      }
      router.refresh()
    })
  }

  return (
    <section className="max-w-3xl space-y-3 border-t border-slate-200 pt-6 dark:border-slate-800">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedText id="m_1ea2151f420bf8" />
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          <GeneratedText id="m_0923313cf732bc" />
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          paramKey="baseQ"
          pageParamKey="basePage"
          placeholder={tGenerated('m_0cf585673e0c6b')}
        />
        <FilterChips
          basePath={BASE_PATH}
          currentParams={currentParams}
          paramKey="baseState"
          pageParamKey="basePage"
          label={tGenerated('m_08f5e6a9cabec6')}
          allLabel="All locations"
          options={[
            { value: 'base', label: 'At base' },
            { value: 'other', label: 'Not at base' },
          ]}
        />
        <span className="text-sm text-slate-500 dark:text-slate-400">
          <GeneratedValue value={total.toLocaleString()} /> <GeneratedText id="m_1628f9f6204c4f" />
          <GeneratedValue value={total === 1 ? '' : <GeneratedText id="m_00ded356f0f424" />} />
        </span>
      </div>

      <div className="max-w-2xl divide-y overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        <GeneratedValue
          value={
            rows.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-400">
                <GeneratedText id="m_0f71c5149a1945" />
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
                      <GeneratedValue value={row.name} />
                    </span>
                    <span className="block truncate text-xs text-slate-400">
                      <GeneratedValue value={[row.level, row.code].filter(Boolean).join(' · ')} />
                    </span>
                  </span>
                  <GeneratedValue
                    value={
                      row.isBase ? (
                        <Badge variant="success">
                          <GeneratedText id="m_0a2f5728384deb" />
                        </Badge>
                      ) : null
                    }
                  />
                </label>
              ))
            )
          }
        />
      </div>

      <GeneratedValue
        value={
          error ? (
            <p className="text-sm text-red-600 dark:text-red-400">
              <GeneratedValue value={error} />
            </p>
          ) : null
        }
      />
      <GeneratedValue
        value={
          pending ? (
            <p className="text-xs text-slate-500">
              <GeneratedText id="m_0ef65a53ea7691" />
            </p>
          ) : null
        }
      />
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
