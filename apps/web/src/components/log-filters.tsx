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
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const [value, setValue] = useState(search.get(paramKey) ?? '')

  useEffect(() => {
    // Re-sync the input when the URL changes externally (back/forward, chip clear).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(search.get(paramKey) ?? '')
  }, [search, paramKey])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

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
  const [from, setFrom] = useState(search.get('from') ?? '')
  const [to, setTo] = useState(search.get('to') ?? '')

  useEffect(() => {
    // Re-sync the inputs when the URL changes externally (back/forward, chip clear).
    /* eslint-disable react-hooks/set-state-in-effect */
    setFrom(search.get('from') ?? '')
    setTo(search.get('to') ?? '')
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [search])

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
          id="from"
          type="date"
          className="h-8 w-44"
          value={from}
          onChange={(e) => {
            const v = e.target.value
            setFrom(v)
            apply(v, to)
          }}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="to" className="text-xs">
          To
        </Label>
        <Input
          id="to"
          type="date"
          className="h-8 w-44"
          value={to}
          onChange={(e) => {
            const v = e.target.value
            setTo(v)
            apply(from, v)
          }}
        />
      </div>
    </>
  )
}
