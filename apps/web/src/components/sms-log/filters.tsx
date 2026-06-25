'use client'

// Client-side filter bar for the SMS log list: recipient (phone) text input +
// from/to date pickers. Pushes updates to the URL via router.replace so the
// list page (server component) re-renders. Route-agnostic — works under both
// /admin/sms-log and /platform/sms-log. Mirrors the email-log filters.

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Input, Label } from '@beaconhs/ui'

export function PhoneFilter() {
  const pathname = usePathname()
  const router = useRouter()
  const search = useSearchParams()
  const [value, setValue] = useState(search.get('recipient') ?? '')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValue(search.get('recipient') ?? '')
  }, [search])

  useEffect(() => {
    const handle = setTimeout(() => {
      const next = new URLSearchParams(search.toString())
      if (value) next.set('recipient', value)
      else next.delete('recipient')
      next.delete('page')
      const qs = next.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname)
    }, 300)
    return () => clearTimeout(handle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <div className="space-y-1.5">
      <Label htmlFor="recipient" className="text-xs">
        Recipient
      </Label>
      <Input
        id="recipient"
        type="tel"
        className="h-8 w-48"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="+15551234567"
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
