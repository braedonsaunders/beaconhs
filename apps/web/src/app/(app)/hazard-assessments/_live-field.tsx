'use client'

// Always-editable fields that auto-save through the generic `updateTextField`
// action — the legacy form's killer mobile trait, modernised. No edit-pencil,
// no drawer: the input on the page IS the field. Text saves on blur (plus a
// debounce while typing stops); selects save on change. A tiny status dot
// tells the crew their work is safe.

import { useEffect, useRef, useState, useTransition } from 'react'
import { Input, SearchSelect, Select, Textarea, cn, type SelectOption } from '@beaconhs/ui'

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

function useAutoSave({
  id,
  field,
  updateAction,
}: {
  id: string
  field: string
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [state, setState] = useState<SaveState>('idle')
  const [, start] = useTransition()
  const latest = useRef<string>('')
  const inFlight = useRef(false)

  function save(value: string) {
    latest.current = value
    if (inFlight.current) return // the in-flight completion re-checks latest
    inFlight.current = true
    setState('saving')
    const fd = new FormData()
    fd.set('id', id)
    fd.set('field', field)
    fd.set('value', value)
    start(async () => {
      try {
        await updateAction(fd)
        inFlight.current = false
        if (latest.current !== value) {
          save(latest.current) // user kept typing while we saved
        } else {
          setState('saved')
          setTimeout(() => setState((s) => (s === 'saved' ? 'idle' : s)), 2000)
        }
      } catch {
        inFlight.current = false
        setState('error')
      }
    })
  }

  return { state, setState, save }
}

function SaveDot({ state }: { state: SaveState }) {
  if (state === 'idle') return null
  return (
    <span
      className={cn(
        'text-[11px] font-medium',
        state === 'saving' && 'text-slate-400',
        state === 'dirty' && 'text-slate-400',
        state === 'saved' && 'text-emerald-600',
        state === 'error' && 'text-red-600',
      )}
    >
      {state === 'saving'
        ? 'Saving…'
        : state === 'dirty'
          ? '…'
          : state === 'saved'
            ? 'Saved ✓'
            : 'Not saved — retry'}
    </span>
  )
}

export function LiveField({
  id,
  field,
  label,
  initialValue,
  multiline = false,
  rows = 3,
  placeholder,
  disabled,
  updateAction,
}: {
  id: string
  field: string
  label: string
  initialValue: string | null
  multiline?: boolean
  rows?: number
  placeholder?: string
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const { state, setState, save } = useAutoSave({ id, field, updateAction })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const baseline = useRef(initialValue ?? '')

  // Server revalidation (another section saved) refreshes props; adopt the
  // new value unless the user has unsaved edits in this exact field.
  useEffect(() => {
    const next = initialValue ?? ''
    if (state === 'idle' && next !== baseline.current) {
      baseline.current = next
      setValue(next)
    }
  }, [initialValue, state])

  function onChange(next: string) {
    setValue(next)
    setState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(next), 1200)
  }

  function commit(next: string) {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (next === baseline.current) {
      setState('idle')
      return
    }
    baseline.current = next
    save(next)
  }

  const shared = {
    value,
    placeholder,
    disabled,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    onBlur: () => commit(value),
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </label>
        <SaveDot state={state} />
      </div>
      {multiline ? <Textarea rows={rows} {...shared} /> : <Input {...shared} />}
    </div>
  )
}

export function LiveSelect({
  id,
  field,
  label,
  initialValue,
  options,
  emptyLabel = '—',
  disabled,
  updateAction,
}: {
  id: string
  field: string
  label: string
  initialValue: string | null
  options: { value: string; label: string }[]
  emptyLabel?: string
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const { state, save } = useAutoSave({ id, field, updateAction })

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </label>
        <SaveDot state={state} />
      </div>
      <Select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value)
          save(e.target.value)
        }}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
}

export function LivePersonSelect({
  id,
  field,
  label,
  initialValue,
  options,
  disabled,
  updateAction,
}: {
  id: string
  field: string
  label: string
  initialValue: string | null
  options: SelectOption[]
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const { state, save } = useAutoSave({ id, field, updateAction })

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </label>
        <SaveDot state={state} />
      </div>
      <SearchSelect
        value={value}
        onChange={(next) => {
          setValue(next)
          save(next)
        }}
        options={options}
        placeholder="Select a person…"
        searchPlaceholder="Search active people…"
        sheetTitle="Select supervisor"
        ariaLabel={label}
        clearable
        emptyLabel="— None —"
        disabled={disabled}
      />
    </div>
  )
}

export function LiveDateTime({
  id,
  field,
  label,
  initialValue,
  disabled,
  updateAction,
}: {
  id: string
  field: string
  label: string
  /** datetime-local formatted string, e.g. 2026-06-11T14:30 */
  initialValue: string
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue)
  const { state, save } = useAutoSave({ id, field, updateAction })

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase">
          {label}
        </label>
        <SaveDot state={state} />
      </div>
      <Input
        type="datetime-local"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value)
          if (e.target.value) save(e.target.value)
        }}
      />
    </div>
  )
}
