'use client'

// Client-side filter controls shared by the email-log and SMS-log list views:
// a debounced text param filter (recipient address / phone) and from/to date
// pickers. Updates push to the URL via router.replace so the list page (server
// component) re-renders. Route-agnostic — they push to the current pathname,
// so they work under both the /admin and /platform log routes.

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input, Label } from '@beaconhs/ui'

export function TextParamFilter({
  paramKey,
  label,
  type = 'text',
  placeholder,
  className = 'h-8 w-56',
}: {
  paramKey: string
  label: string
  type?: 'text' | 'tel'
  placeholder?: string
  className?: string
}) {
  const search = useSearchParams()
  const initialValue = search.get(paramKey) ?? ''

  // A URL value change remounts the controlled input. This keeps back/forward
  // navigation authoritative without a cascading state-reset effect.
  return (
    <TextParamFilterControl
      key={`${paramKey}:${initialValue}`}
      paramKey={paramKey}
      label={label}
      type={type}
      placeholder={placeholder}
      className={className}
      initialValue={initialValue}
    />
  )
}

function TextParamFilterControl({
  paramKey,
  label,
  type,
  placeholder,
  className,
  initialValue,
}: {
  paramKey: string
  label: string
  type: 'text' | 'tel'
  placeholder?: string
  className: string
  initialValue: string
}) {
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const [value, setValue] = useState(initialValue)

  useEffect(() => {
    const handle = setTimeout(() => {
      // No-op when the input already matches the URL (mount, external URL
      // change) — navigating anyway would strip the page param and reset
      // deep-linked/refreshed pagination back to page 1.
      if (value === (search.get(paramKey) ?? '')) return
      const next = new URLSearchParams(search.toString())
      if (value) next.set(paramKey, value)
      else next.delete(paramKey)
      next.delete('page')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    }, 300)
    return () => clearTimeout(handle)
  }, [paramKey, pathname, router, search, value])

  return (
    <div className="space-y-1.5">
      <Label htmlFor={paramKey} className="text-xs">
        {label}
      </Label>
      <Input
        id={paramKey}
        type={type}
        className={className}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
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

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="from" className="text-xs">
          From
        </Label>
        <Input
          key={`from:${from}`}
          id="from"
          type="date"
          className="h-8 w-44"
          defaultValue={from}
          onChange={(e) => {
            const v = e.target.value
            apply(v, to)
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="to" className="text-xs">
          To
        </Label>
        <Input
          key={`to:${to}`}
          id="to"
          type="date"
          className="h-8 w-44"
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
