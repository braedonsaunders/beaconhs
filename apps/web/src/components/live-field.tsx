'use client'

// Always-editable fields that auto-save through a generic `updateTextField`
// action — the legacy form's killer mobile trait, modernised. No edit-pencil,
// no drawer: the input on the page IS the field. Text saves on blur (plus a
// debounce while typing stops); selects/toggles/ratings save on change. A tiny
// status dot tells the crew their work is safe.
//
// Shared primitive — used by the hazard-assessment and incident detail pages
// (and any future field module). See the hazard-assessment detail page for the
// canonical single-page-form recipe.

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  Input,
  RichTextEditor,
  SearchSelect,
  Select,
  Textarea,
  cn,
  type SelectOption,
} from '@beaconhs/ui'

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

function FieldLabel({ label, state }: { label: string; state: SaveState }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {label}
      </label>
      <SaveDot state={state} />
    </div>
  )
}

export function LiveField({
  id,
  field,
  label,
  initialValue,
  multiline = false,
  rows = 3,
  type = 'text',
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
  /** Input type for single-line fields. Ignored when `multiline`. */
  type?: 'text' | 'number' | 'date'
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
      <FieldLabel label={label} state={state} />
      {multiline ? <Textarea rows={rows} {...shared} /> : <Input type={type} {...shared} />}
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
  allowEmpty = true,
  disabled,
  updateAction,
}: {
  id: string
  field: string
  label: string
  initialValue: string | null
  options: { value: string; label: string }[]
  emptyLabel?: string
  /** Render a blank option. Set false for NOT-NULL enum columns. */
  allowEmpty?: boolean
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const { state, save } = useAutoSave({ id, field, updateAction })

  return (
    <div className="space-y-1">
      <FieldLabel label={label} state={state} />
      <Select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value)
          save(e.target.value)
        }}
      >
        {allowEmpty ? <option value="">{emptyLabel}</option> : null}
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
  sheetTitle = 'Select person',
  placeholder = 'Select a person…',
  searchPlaceholder = 'Search active people…',
  disabled,
  updateAction,
}: {
  id: string
  field: string
  label: string
  initialValue: string | null
  options: SelectOption[]
  sheetTitle?: string
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue ?? '')
  const { state, save } = useAutoSave({ id, field, updateAction })

  return (
    <div className="space-y-1">
      <FieldLabel label={label} state={state} />
      <SearchSelect
        value={value}
        onChange={(next) => {
          setValue(next)
          save(next)
        }}
        options={options}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        sheetTitle={sheetTitle}
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
      <FieldLabel label={label} state={state} />
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

/**
 * Tap-to-save boolean switch. Saves `'true'`/`'false'` strings — the server
 * action coerces them back to a boolean column. Optimistic; adopts the server
 * value on revalidation while idle.
 */
export function LiveToggle({
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
  initialValue: boolean
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [on, setOn] = useState(initialValue)
  const { state, save } = useAutoSave({ id, field, updateAction })
  const baseline = useRef(initialValue)

  useEffect(() => {
    if (state === 'idle' && initialValue !== baseline.current) {
      baseline.current = initialValue
      setOn(initialValue)
    }
  }, [initialValue, state])

  function toggle() {
    if (disabled) return
    const next = !on
    setOn(next)
    baseline.current = next
    save(next ? 'true' : 'false')
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900">
      <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
        {label}
        {state === 'saving' ? (
          <span className="text-[11px] text-slate-400">Saving…</span>
        ) : state === 'saved' ? (
          <span className="text-[11px] text-emerald-600">Saved ✓</span>
        ) : state === 'error' ? (
          <span className="text-[11px] text-red-600">Retry</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={toggle}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          on ? 'bg-teal-600' : 'bg-slate-300 dark:bg-slate-700',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform',
            on ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  )
}

const SEVERITY_LABELS: Record<number, string> = {
  1: 'No first aid / no damage',
  2: 'First aid / < $1k',
  3: 'Medical aid / < $5k',
  4: 'Critical / < $25k',
  5: 'Fatality / > $25k',
}

const SEVERITY_ACTIVE: Record<number, string> = {
  1: 'border-emerald-400 bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-700',
  2: 'border-lime-400 bg-lime-100 text-lime-900 dark:bg-lime-950/50 dark:text-lime-200 dark:border-lime-700',
  3: 'border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-700',
  4: 'border-orange-400 bg-orange-100 text-orange-900 dark:bg-orange-950/50 dark:text-orange-200 dark:border-orange-700',
  5: 'border-red-400 bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-200 dark:border-red-700',
}

/**
 * Editable 1–5 severity picker (the auto-save counterpart of the read-only
 * `SeverityRating`). Tap a cell to set; tap the active cell again to clear.
 * Saves the number as a string (empty clears the column to null).
 */
export function LiveSeverityRating({
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
  initialValue: number | null
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [value, setValue] = useState<number | null>(initialValue)
  const { state, save } = useAutoSave({ id, field, updateAction })
  const baseline = useRef(initialValue)

  useEffect(() => {
    if (state === 'idle' && initialValue !== baseline.current) {
      baseline.current = initialValue
      setValue(initialValue)
    }
  }, [initialValue, state])

  function pick(n: number) {
    if (disabled) return
    const next = value === n ? null : n
    setValue(next)
    baseline.current = next
    save(next == null ? '' : String(next))
  }

  return (
    <div className="space-y-1">
      <FieldLabel label={label} state={state} />
      <div className="flex items-center gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const active = value === n
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => pick(n)}
              title={`${n} — ${SEVERITY_LABELS[n]}`}
              aria-pressed={active}
              className={cn(
                'flex h-11 flex-1 items-center justify-center rounded-lg border text-sm font-semibold transition-colors disabled:opacity-50 sm:h-9',
                active
                  ? SEVERITY_ACTIVE[n]
                  : 'border-slate-200 bg-white text-slate-400 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-500',
              )}
            >
              {n}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500">
        {value ? SEVERITY_LABELS[value] : 'Not rated'}
      </p>
    </div>
  )
}

// Is this HTML effectively blank? (fresh TipTap doc, stray tags, &nbsp; only)
function htmlIsEmpty(html: string): boolean {
  return (
    html
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim().length === 0
  )
}

/**
 * Auto-saving rich-text field. Many legacy narrative columns hold HTML
 * (`<p>`, `<strong>`, `&nbsp;`…) — a plain textarea would show the raw markup,
 * so this renders the formatted HTML and edits it with the shared
 * `RichTextEditor`, saving HTML back. Click-to-edit: the heavy TipTap editor
 * mounts only while a field is being edited (one at a time), keeping the
 * single-page form light on phones.
 */
export function LiveRichText({
  id,
  field,
  label,
  initialValue,
  placeholder = 'Add…',
  disabled,
  updateAction,
}: {
  id: string
  field: string
  label: string
  initialValue: string | null
  placeholder?: string
  disabled?: boolean
  updateAction: (formData: FormData) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(initialValue ?? '')
  const { state, setState, save } = useAutoSave({ id, field, updateAction })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const baseline = useRef(initialValue ?? '')

  // Adopt the server value on revalidation, unless we're editing this field.
  useEffect(() => {
    const next = initialValue ?? ''
    if (!editing && state === 'idle' && next !== baseline.current) {
      baseline.current = next
      setValue(next)
    }
  }, [initialValue, state, editing])

  function onChange(html: string) {
    setValue(html)
    setState('dirty')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => commit(html), 1000)
  }

  function commit(html: string) {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (html === baseline.current) {
      setState('idle')
      return
    }
    baseline.current = html
    save(html)
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {label}
        </label>
        <div className="flex items-center gap-2">
          <SaveDot state={state} />
          {disabled ? null : editing ? (
            <button
              type="button"
              onClick={() => {
                commit(value)
                setEditing(false)
              }}
              className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Done
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[11px] font-medium text-teal-700 hover:underline dark:text-teal-400"
            >
              Edit
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <RichTextEditor
          defaultValue={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          minHeight="120px"
        />
      ) : (
        <div
          role={disabled ? undefined : 'button'}
          tabIndex={disabled ? undefined : 0}
          onClick={() => {
            if (!disabled) setEditing(true)
          }}
          onKeyDown={(e) => {
            if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              setEditing(true)
            }
          }}
          className={cn(
            'min-h-[2.5rem] rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-900',
            !disabled && 'cursor-text hover:border-slate-300 dark:hover:border-slate-700',
          )}
        >
          {htmlIsEmpty(value) ? (
            <span className="text-slate-400 dark:text-slate-500">{placeholder}</span>
          ) : (
            <div
              className="prose prose-sm prose-slate dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{ __html: value }}
            />
          )}
        </div>
      )}
    </div>
  )
}
