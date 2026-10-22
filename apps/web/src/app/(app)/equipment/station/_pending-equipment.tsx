'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import { Button, Select } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { parsePrefixedListParams } from '@/lib/list-params'
import type { StationSearchResults } from '@/lib/equipment-station'

export type PendingMovement = StationSearchResults['equipment'][number] & {
  direction: 'in' | 'out'
  error?: string
  undoLogKey?: string
}

export function PendingEquipment({
  items,
  disabled,
  onRemove,
  onDirectionChange,
}: {
  items: PendingMovement[]
  disabled: boolean
  onRemove?: (id: string) => void
  onDirectionChange?: (id: string, direction: 'in' | 'out') => void
}) {
  const translate = useGeneratedValueTranslations()
  const path = usePathname()
  const search = useSearchParams()
  const params = Object.fromEntries(search.entries())
  const {
    q,
    page: requestedPage,
    perPage,
  } = parsePrefixedListParams(params, 'pending', {
    sort: 'name',
    allowedSorts: ['name'],
    perPage: 10,
  })
  const filtered = items.filter(
    (item) =>
      (!q || `${item.assetTag} ${item.name}`.toLowerCase().includes(q.toLowerCase())) &&
      (!params.pendingAction ||
        params.pendingAction === 'all' ||
        item.direction === params.pendingAction),
  )
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(filtered.length / perPage)))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <SearchInput
          placeholder={translate('Search pending equipment…')}
          paramKey="pendingQ"
          pageParamKey="pendingPage"
        />
        <FilterChips
          basePath={path}
          currentParams={params}
          paramKey="pendingAction"
          pageParamKey="pendingPage"
          label={translate('Action')}
          options={[
            { value: 'out', label: 'Check out' },
            { value: 'in', label: 'Check in' },
          ]}
        />
      </div>
      <ul
        aria-label={translate('Pending equipment')}
        className="divide-y divide-slate-200 dark:divide-slate-700"
      >
        {filtered.slice((page - 1) * perPage, page * perPage).map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {item.assetTag} · {item.name}
              </p>
              {item.error && (
                <p role="alert" className="text-red-600 dark:text-red-400">
                  <GeneratedValue value={item.error} />
                </p>
              )}
            </div>
            {onDirectionChange ? (
              <Select
                aria-label={`${translate('Action')}: ${item.assetTag}`}
                value={item.direction}
                disabled={disabled}
                onChange={(event) => onDirectionChange(item.id, event.target.value as 'in' | 'out')}
                className="w-32 shrink-0"
              >
                <option value="out">{translate('Check out')}</option>
                <option value="in">{translate('Check in')}</option>
              </Select>
            ) : (
              <GeneratedValue value={item.direction === 'out' ? 'Check out' : 'Check in'} />
            )}
            {onRemove && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-label={`${translate('Remove')}: ${item.assetTag}`}
                onClick={() => onRemove(item.id)}
              >
                <GeneratedValue value="Remove" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {filtered.length === 0 && (
        <p className="text-sm text-slate-500">
          <GeneratedValue value="No pending equipment matches." />
        </p>
      )}
      <Pagination
        basePath={path}
        currentParams={params}
        total={filtered.length}
        page={page}
        perPage={perPage}
        pageParamKey="pendingPage"
      />
    </div>
  )
}
