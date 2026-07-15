'use client'
import { useGeneratedValueTranslations } from '@/i18n/generated'

// Searchable single-select list filter. A SearchSelect that writes the chosen
// value into a URL param (and resets page=1), the searchable counterpart of
// FilterChips for large option sets — people, courses, skill types — where a
// fixed chip dropdown would either overflow or silently truncate. Selecting
// navigates; clearing removes the param.

import { useRouter } from 'next/navigation'
import { SearchSelect, type SelectOption } from '@beaconhs/ui'
import { mergeHref } from '@/lib/list-params'

export function SearchFilter({
  basePath,
  currentParams,
  paramKey,
  options,
  placeholder,
  allLabel,
  searchPlaceholder,
  ariaLabel,
  className = 'w-52',
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  paramKey: string
  options: SelectOption[]
  placeholder: string
  /** Label for the "clear filter" option. Defaults to the placeholder. */
  allLabel?: string
  searchPlaceholder?: string
  ariaLabel?: string
  className?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const value =
    typeof currentParams[paramKey] === 'string' ? (currentParams[paramKey] as string) : ''
  return (
    <SearchSelect
      value={value}
      onChange={(next) =>
        router.push(
          mergeHref(basePath, currentParams, {
            [paramKey]: next || undefined,
            page: 1,
          }) as never,
        )
      }
      options={options}
      placeholder={tGeneratedValue(placeholder)}
      searchPlaceholder={tGeneratedValue(searchPlaceholder ?? placeholder)}
      ariaLabel={ariaLabel ?? placeholder}
      sheetTitle={placeholder}
      clearable
      emptyLabel={tGeneratedValue(allLabel ?? placeholder)}
      className={className}
      triggerClassName="h-8 text-sm"
    />
  )
}
