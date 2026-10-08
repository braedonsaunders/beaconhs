'use client'

import { GeneratedText, GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

// Client-side filter controls shared by the email-log and SMS-log list views:
// a debounced text param filter (recipient address / phone) and from/to date
// pickers. Updates push to the URL via router.replace so the list page (server
// component) re-renders. Route-agnostic — they push to the current pathname,
// so they work under both the /admin and /platform log routes.

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input, Label } from '@beaconhs/ui'
import { SearchInput } from './search-input'

export function TextParamFilter({
  paramKey,
  label,
  placeholder,
  className = 'relative w-56',
}: {
  paramKey: string
  label: string
  placeholder?: string
  className?: string
}) {
  const translate = useGeneratedValueTranslations()
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs whitespace-nowrap text-slate-500 dark:text-slate-400">
        {translate(label)}
      </span>
      <SearchInput
        paramKey={paramKey}
        searchLabel={label}
        placeholder={placeholder}
        className={className}
      />
    </div>
  )
}

export function DateRangeFilter() {
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const from = search.get('from') ?? ''
  const to = search.get('to') ?? ''

  function apply(nextFrom: string, nextTo: string) {
    const next = new URLSearchParams(search.toString())
    if (nextFrom) next.set('from', nextFrom)
    else next.delete('from')
    if (nextTo) next.set('to', nextTo)
    else next.delete('to')
    next.delete('page')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname)
  }

  // Inline labels keep the whole range on one h-8 row, aligned with the other
  // toolbar controls.
  return (
    <>
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor="from"
          className="text-xs whitespace-nowrap text-slate-500 dark:text-slate-400"
        >
          <GeneratedText id="m_154c9d7a784dda" />
        </Label>
        <Input
          key={`from:${from}`}
          id="from"
          type="date"
          className="h-8 w-40"
          defaultValue={from}
          onChange={(e) => {
            const v = e.target.value
            apply(v, to)
          }}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <Label
          htmlFor="to"
          className="text-xs whitespace-nowrap text-slate-500 dark:text-slate-400"
        >
          <GeneratedText id="m_0ea10a854847b2" />
        </Label>
        <Input
          key={`to:${to}`}
          id="to"
          type="date"
          className="h-8 w-40"
          defaultValue={to}
          onChange={(e) => {
            const v = e.target.value
            apply(from, v)
          }}
        />
      </div>
    </>
  )
}
