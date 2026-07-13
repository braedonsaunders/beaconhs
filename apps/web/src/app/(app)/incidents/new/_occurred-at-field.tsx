'use client'

// "Occurred at" input for the quick-report form. The default must be the
// USER's wall clock, so it is computed in the browser after mount — a
// server-rendered default would carry the server's timezone (UTC in prod)
// and pre-fill a time hours off. The visible datetime-local input holds the
// local pick; a hidden field submits the unambiguous ISO timestamp so the
// server action never re-interprets a timezone-less string in its own zone.

import { useState, useSyncExternalStore } from 'react'
import { Input } from '@beaconhs/ui'

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const clientDefault = typeof window === 'undefined' ? '' : toLocalInputValue(new Date())
const subscribe = () => () => undefined

export function OccurredAtField({ name }: { name: string }) {
  const defaultValue = useSyncExternalStore(
    subscribe,
    () => clientDefault,
    () => '',
  )
  const [editedValue, setEditedValue] = useState<string | null>(null)
  const value = editedValue ?? defaultValue

  const parsed = value ? new Date(value) : null
  const iso = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : ''

  return (
    <>
      <Input
        type="datetime-local"
        required
        value={value}
        onChange={(e) => setEditedValue(e.target.value)}
      />
      <input type="hidden" name={name} value={iso} />
    </>
  )
}
