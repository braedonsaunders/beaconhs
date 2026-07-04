'use client'

// Auto-saving multi-select field — the array cousin of LiveSelect. Renders the
// current selection as removable chips and a SearchSelect to add more; every
// add/remove posts the full id list to a server action and shows the shared
// SaveDot status. Used for a person's group memberships and title assignments,
// where each concept collapses to a single inline field on the overview.

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { SearchSelect } from '@beaconhs/ui'
import { SaveDot, useAutoSave } from './live-field'

export type MultiOption = { value: string; label: string; color?: string | null }

export function LiveMultiSelect({
  id,
  label,
  initialValue,
  options,
  disabled,
  updateAction,
  placeholder = 'Add…',
  searchPlaceholder = 'Search…',
  sheetTitle,
  emptyLabel = 'None',
}: {
  /** Record id (person id) — posted as `id`. */
  id: string
  label: string
  /** Currently-selected option values. */
  initialValue: string[]
  /** All selectable options (value + label, optional chip colour). */
  options: MultiOption[]
  disabled?: boolean
  /** Server action reading `id` + repeated `value` entries (the full new list). */
  updateAction: (formData: FormData) => Promise<void>
  placeholder?: string
  searchPlaceholder?: string
  sheetTitle?: string
  emptyLabel?: string
}) {
  const [ids, setIds] = useState<string[]>(initialValue)
  const baseline = useRef(initialValue.join(','))
  const { state, save, retry } = useAutoSave({
    prepare: (value) => {
      const fd = new FormData()
      fd.set('id', id)
      for (const v of value ? value.split(',').filter(Boolean) : []) fd.append('value', v)
      return fd
    },
    updateAction,
    onSaved: (v) => {
      baseline.current = v
    },
  })

  // Adopt the server value on revalidation while idle (another section saved).
  useEffect(() => {
    const next = initialValue.join(',')
    if (state === 'idle' && next !== baseline.current) {
      baseline.current = next
      setIds(initialValue)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue.join(','), state])

  const optMap = new Map(options.map((o) => [o.value, o]))
  const available = options.filter((o) => !ids.includes(o.value))

  function commit(next: string[]) {
    setIds(next)
    save(next.join(','))
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {label}
        </label>
        <SaveDot state={state} onRetry={retry} />
      </div>
      {ids.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {ids.map((v) => {
            const o = optMap.get(v)
            return (
              <li
                key={v}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                style={o?.color ? { borderColor: o.color } : undefined}
              >
                {o?.color ? (
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: o.color }}
                  />
                ) : null}
                <span>{o?.label ?? v}</span>
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => commit(ids.filter((x) => x !== v))}
                    className="text-slate-400 hover:text-red-600"
                    aria-label={`Remove ${o?.label ?? v}`}
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-sm text-slate-400 dark:text-slate-500">{emptyLabel}</p>
      )}
      {!disabled ? (
        <SearchSelect
          value=""
          onChange={(next) => {
            if (next && !ids.includes(next)) commit([...ids, next])
          }}
          options={available.map((o) => ({ value: o.value, label: o.label }))}
          placeholder={placeholder}
          searchPlaceholder={searchPlaceholder}
          sheetTitle={sheetTitle ?? label}
          ariaLabel={`Add ${label}`}
        />
      ) : null}
    </div>
  )
}
