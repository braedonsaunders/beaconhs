'use client'

import { useGeneratedValueTranslations } from '@/i18n/generated'

import { useEffect, useMemo, useState, type ComponentProps } from 'react'
import { useRouter } from 'next/navigation'
import { SearchSelect, type SelectOption } from '@beaconhs/ui'
import { isPickerOptionsResponse, type PickerLookup, type PickerOption } from '@/lib/picker-options'
import { mergeHref } from '@/lib/list-params'

const DEBOUNCE_MS = 250

export type RemoteSearchLoader = (input: {
  query: string
  selected: string | null
  contextId?: string
}) => Promise<unknown>

export function RemoteSearchSelect({
  lookup,
  loadOptions,
  contextId,
  value,
  onChange,
  onOptionChange,
  initialOption,
  excludedValues = [],
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  sheetTitle,
  ariaLabel,
  clearable = true,
  emptyLabel = 'None',
  disabled = false,
  invalid = false,
  id,
  className,
  triggerClassName,
}: {
  /** Authenticated purpose-specific API lookup. Omit only when `loadOptions` supplies an equally scoped source. */
  lookup?: PickerLookup
  /** Action-backed source for PIN-gated/public surfaces that cannot call the authenticated picker API. */
  loadOptions?: RemoteSearchLoader
  /** Required only by lookups whose candidate set belongs to one parent row. */
  contextId?: string
  value: string
  onChange: (value: string) => void
  /** Optional selected option payload for multi-value parents that retain labels locally. */
  onOptionChange?: (option: PickerOption | undefined) => void
  /** Immediate label hydration while the selected-ID lookup is in flight. */
  initialOption?: PickerOption
  /** Hide already-added rows in multi-value composition UIs. */
  excludedValues?: readonly string[]
  placeholder?: string
  searchPlaceholder?: string
  sheetTitle?: string
  ariaLabel?: string
  clearable?: boolean
  emptyLabel?: string
  disabled?: boolean
  invalid?: boolean
  id?: string
  className?: string
  triggerClassName?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const [query, setQuery] = useState('')
  const [remoteOptions, setRemoteOptions] = useState<PickerOption[]>([])
  const [loading, setLoading] = useState(!disabled)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (disabled) return

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      try {
        let payload: unknown
        if (loadOptions) {
          payload = await loadOptions({
            query,
            selected: value || null,
            ...(contextId ? { contextId } : {}),
          })
        } else {
          if (!lookup) throw new Error('Picker lookup is not configured')
          const params = new URLSearchParams({ lookup, q: query })
          if (contextId) params.set('contextId', contextId)
          if (value) params.set('selected', value)
          const response = await fetch(`/api/picker-options?${params.toString()}`, {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: controller.signal,
          })
          if (!response.ok) throw new Error(`Picker lookup failed (${response.status})`)
          payload = await response.json()
        }
        if (controller.signal.aborted) return
        if (!isPickerOptionsResponse(payload)) {
          throw new Error('Picker lookup returned an invalid response')
        }
        setError(false)
        setRemoteOptions(payload.options)
        setHasMore(payload.hasMore)
      } catch (lookupError) {
        if (controller.signal.aborted) return
        console.error('[picker-options] lookup failed', {
          lookup: lookup ?? 'action-backed',
          lookupError,
        })
        setError(true)
        setHasMore(false)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [contextId, disabled, loadOptions, lookup, query, value])

  const options = useMemo(() => {
    const excluded = new Set(excludedValues)
    const byId = new Map<string, PickerOption>()
    if (initialOption && initialOption.value === value && !excluded.has(initialOption.value)) {
      byId.set(initialOption.value, initialOption)
    }
    for (const option of remoteOptions) {
      if (!excluded.has(option.value)) byId.set(option.value, option)
    }
    return [...byId.values()]
  }, [excludedValues, initialOption, remoteOptions, value])

  const statusMessage = error
    ? 'Could not load options. Change the search to retry.'
    : hasMore
      ? 'More results exist. Refine your search.'
      : undefined

  return (
    <SearchSelect
      id={id}
      value={value}
      onChange={(next) => {
        onChange(next)
        onOptionChange?.(options.find((option) => option.value === next))
      }}
      options={options}
      placeholder={tGeneratedValue(placeholder)}
      searchPlaceholder={tGeneratedValue(searchPlaceholder)}
      sheetTitle={sheetTitle}
      ariaLabel={ariaLabel ?? placeholder}
      clearable={clearable}
      emptyLabel={tGeneratedValue(emptyLabel)}
      disabled={disabled}
      invalid={invalid}
      className={className}
      triggerClassName={triggerClassName}
      searchable
      remote
      loading={!disabled && loading}
      statusMessage={statusMessage}
      statusTone={error ? 'error' : 'muted'}
      onSearchChange={(next) => {
        const bounded = next.slice(0, 100)
        // SearchSelect reports an empty query whenever an already-reset menu
        // opens. Preserve the loaded rows in that case; clearing a real prior
        // query still changes `query` and therefore starts a fresh lookup.
        if (bounded === query) return
        setQuery(bounded)
        setLoading(true)
        setError(false)
        // Never present stale rows as matches while the debounced request runs.
        setRemoteOptions((current) => current.filter((option) => option.value === value))
        setHasMore(false)
      }}
    />
  )
}

export function RemoteSelectField({
  name,
  defaultValue = '',
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof RemoteSearchSelect>, 'value' | 'onChange'> & {
  name: string
  defaultValue?: string
  onValueChange?: (value: string) => void
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <RemoteSearchSelect
        {...props}
        value={value}
        onChange={(next) => {
          setValue(next)
          onValueChange?.(next)
        }}
      />
    </>
  )
}

export function RemoteSearchFilter({
  lookup,
  loadOptions,
  contextId,
  basePath,
  currentParams,
  paramKey,
  placeholder,
  allLabel,
  searchPlaceholder,
  ariaLabel,
  initialOption,
  className = 'w-52',
  pageParamKey = 'page',
}: {
  /** Authenticated picker capability, or an equally scoped action-backed loader. */
  lookup?: PickerLookup
  loadOptions?: RemoteSearchLoader
  contextId?: string
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  paramKey: string
  placeholder: string
  allLabel?: string
  searchPlaceholder?: string
  ariaLabel?: string
  initialOption?: SelectOption
  className?: string
  pageParamKey?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const router = useRouter()
  const value =
    typeof currentParams[paramKey] === 'string' ? (currentParams[paramKey] as string) : ''
  return (
    <RemoteSearchSelect
      lookup={lookup}
      loadOptions={loadOptions}
      contextId={contextId}
      value={value}
      onChange={(next) =>
        router.push(
          mergeHref(basePath, currentParams, {
            [paramKey]: next || undefined,
            [pageParamKey]: 1,
          }) as never,
        )
      }
      initialOption={initialOption}
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
