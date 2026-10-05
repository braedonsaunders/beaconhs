'use client'

import { useEffect, useRef, useState } from 'react'
import { Input, Label } from '@beaconhs/ui'
import { SaveDot, useAutoSave } from '@/components/live-field'
import { FLUSH_RECORD_SAVES } from '@/lib/pending-record-saves'
import { GeneratedValue } from '@/i18n/generated'

export function ClassSchedule({
  id,
  startsAt,
  endsAt,
  disabled,
  updateAction,
}: {
  id: string
  startsAt: string
  endsAt: string
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const initial = JSON.stringify({ startsAt, endsAt })
  const [values, setValues] = useState({ startsAt, endsAt })
  const latest = useRef(values)
  const baseline = useRef(initial)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const invalid = !values.startsAt || !values.endsAt || values.endsAt <= values.startsAt
  const { state, setState, save, retry, hasPending } = useAutoSave({
    prepare: (raw) => {
      const form = new FormData()
      form.set('id', id)
      form.set('field', 'schedule')
      form.set('value', raw)
      return form
    },
    updateAction: async (form) => {
      const range = JSON.parse(String(form.get('value'))) as { startsAt: string; endsAt: string }
      if (!range.startsAt || !range.endsAt || range.endsAt <= range.startsAt)
        throw new Error('Class end time must be after its start time.')
      await updateAction(form)
    },
    onSaved: (raw) => {
      baseline.current = raw
      dirty.current = JSON.stringify(latest.current) !== raw
    },
  })
  function commit() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const raw = JSON.stringify(latest.current)
    if (raw === baseline.current && !hasPending() && !dirty.current) return
    save(raw)
  }
  useEffect(() => {
    const flush = () => {
      if (!disabled) commit()
    }
    window.addEventListener(FLUSH_RECORD_SAVES, flush)
    return () => window.removeEventListener(FLUSH_RECORD_SAVES, flush)
  })
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  useEffect(() => {
    if (state === 'idle' && initial !== baseline.current) {
      baseline.current = initial
      latest.current = { startsAt, endsAt }
      setValues(latest.current)
    }
  }, [initial, startsAt, endsAt, state])
  function change(field: 'startsAt' | 'endsAt', value: string) {
    dirty.current = true
    latest.current = { ...latest.current, [field]: value }
    setValues(latest.current)
    setState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(commit, 1200)
  }
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(['startsAt', 'endsAt'] as const).map((field) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`class-${field}`}>
              <GeneratedValue value={field === 'startsAt' ? 'Starts' : 'Ends'} />
            </Label>
            <Input
              id={`class-${field}`}
              type="datetime-local"
              value={values[field]}
              disabled={disabled}
              onChange={(event) => change(field, event.target.value)}
              onBlur={commit}
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <SaveDot state={state} onRetry={retry} />
        <GeneratedValue value="Start and end times save together." />
      </div>
      {invalid ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          <GeneratedValue value="Enter both times. End must be after Start before the schedule can save." />
        </p>
      ) : null}
    </div>
  )
}
