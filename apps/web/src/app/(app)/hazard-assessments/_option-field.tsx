'use client'

// Structured inline editors bound to the generic `updateTextField` action —
// the picker-driven siblings of <InlineField>. Where the old UI asked for
// "comma separated" free text, these render the curated vocabulary as toggle
// chips (multi) or radio pills (single) and still allow custom entries, so
// terminology stays consistent without blocking the crew.

import { useState, useTransition } from 'react'
import { Button, Input, cn } from '@beaconhs/ui'
import { Pencil, Plus } from 'lucide-react'

function Chip({
  active,
  onClick,
  children,
  disabled,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-teal-600 bg-teal-600 text-white'
          : 'border-slate-300 bg-white text-slate-700 hover:border-teal-400 hover:text-teal-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      {children}
    </button>
  )
}

/**
 * Multi-select chips persisted as a comma-separated string through
 * `updateTextField` (the action splits on commas for array fields).
 *
 * Chips are LIVE: tapping one toggles it and saves immediately (optimistic,
 * coalesced while requests are in flight) — no edit/save ceremony, matching
 * the one-tap feel crews had in the legacy form.
 */
export function MultiOptionField({
  id,
  field,
  label,
  options,
  initialSelected,
  disabled,
  updateAction,
  helper,
}: {
  id: string
  field: string
  label: string
  options: readonly string[]
  initialSelected: string[]
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
  helper?: string
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected)
  const [custom, setCustom] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [pending, start] = useTransition()

  // Previously saved custom entries render as chips too.
  const allOptions = [...options, ...selected.filter((s) => !options.includes(s))]

  function persist(next: string[]) {
    setSelected(next)
    const fd = new FormData()
    fd.set('id', id)
    fd.set('field', field)
    fd.set('value', next.join(', '))
    start(async () => {
      await updateAction(fd)
    })
  }

  function toggle(v: string) {
    persist(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  }

  function addCustom() {
    const v = custom.trim()
    if (!v) return
    setCustom('')
    setShowCustom(false)
    if (!selected.includes(v)) persist([...selected, v])
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
        {pending ? <span className="text-[11px] text-slate-400">Saving…</span> : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {allOptions.map((o) => (
          <Chip key={o} active={selected.includes(o)} onClick={() => toggle(o)} disabled={disabled}>
            {o}
          </Chip>
        ))}
        {!disabled ? (
          showCustom ? null : (
            <button
              type="button"
              onClick={() => setShowCustom(true)}
              className="inline-flex min-h-9 items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 text-xs text-slate-500 hover:border-teal-400 hover:text-teal-700 sm:min-h-0 sm:py-1 dark:border-slate-700"
            >
              <Plus size={12} /> Other
            </button>
          )
        ) : null}
      </div>
      {showCustom ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustom()
              }
            }}
            placeholder="Type and add…"
            className="h-9 max-w-60 text-sm"
          />
          <Button type="button" variant="outline" size="sm" onClick={addCustom}>
            Add
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowCustom(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {helper ? <p className="text-[11px] text-slate-500">{helper}</p> : null}
    </div>
  )
}

/**
 * Single-select pills persisted as a plain value through `updateTextField`.
 * Use for enum-backed columns (CS form type, rescue style, HRC level) where
 * free text would be rejected by Postgres.
 */
export function SingleOptionField({
  id,
  field,
  label,
  options,
  initialValue,
  disabled,
  updateAction,
  allowClear = false,
}: {
  id: string
  field: string
  label: string
  options: readonly { value: string; label: string }[] | readonly string[]
  initialValue: string | null
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
  allowClear?: boolean
}) {
  const normalized = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
  const [pending, start] = useTransition()

  function select(value: string) {
    if (disabled || pending) return
    const next = allowClear && value === initialValue ? '' : value
    if (next === (initialValue ?? '')) return
    const fd = new FormData()
    fd.set('id', id)
    fd.set('field', field)
    fd.set('value', next)
    start(() => updateAction(fd))
  }

  return (
    <div>
      <div className="text-xs tracking-wide text-slate-500 uppercase">{label}</div>
      <div className={cn('mt-1.5 flex flex-wrap gap-1.5', pending && 'opacity-60')}>
        {normalized.map((o) => (
          <Chip
            key={o.value}
            active={initialValue === o.value}
            onClick={() => select(o.value)}
            disabled={disabled || pending}
          >
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  )
}
