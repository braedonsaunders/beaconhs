'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

// Local-first multi-select field — the array cousin of LiveSelect. Renders the
// current selection as removable chips and a SearchSelect to add more; every
// add/remove queues the full id list for the record (see
// @/lib/offline-drafts/offline-record) and shows the shared SaveDot status.
// Used for a person's group memberships and title assignments, where each
// concept collapses to a single inline field on the overview.

import { X } from 'lucide-react'
import { SearchSelect } from '@beaconhs/ui'
import { useRecordField } from '@/lib/offline-drafts/offline-record'
import { SaveDot } from './live-field'
import { RecordFieldError } from './record-field-error'

type MultiOption = { value: string; label: string; color?: string | null }

export function LiveMultiSelect({
  field,
  label,
  initialValue,
  options,
  disabled,
  placeholder = 'Add…',
  searchPlaceholder = 'Search…',
  sheetTitle,
  emptyLabel = 'None',
}: {
  /** The record saver's op key; the value is the full selected list. */
  field: string
  label: string
  /** Currently-selected option values. */
  initialValue: string[]
  /** All selectable options (value + label, optional chip colour). */
  options: MultiOption[]
  disabled?: boolean
  placeholder?: string
  searchPlaceholder?: string
  sheetTitle?: string
  emptyLabel?: string
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const f = useRecordField<string[]>(field, initialValue)
  const ids = f.value
  const off = disabled || f.paused

  const optMap = new Map(options.map((o) => [o.value, o]))
  const available = options.filter((o) => !ids.includes(o.value))

  function commit(next: string[]) {
    f.commit(next)
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          <GeneratedValue value={label} />
        </label>
        <SaveDot state={f.saveState} error={f.error} onRetry={f.retry} />
      </div>
      <GeneratedValue
        value={
          ids.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              <GeneratedValue
                value={ids.map((v) => {
                  const o = optMap.get(v)
                  return (
                    <li
                      key={v}
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-sm dark:border-slate-700 dark:bg-slate-900"
                      style={o?.color ? { borderColor: o.color } : undefined}
                    >
                      <GeneratedValue
                        value={
                          o?.color ? (
                            <span
                              className="inline-block h-2 w-2 rounded-full"
                              style={{ background: o.color }}
                            />
                          ) : null
                        }
                      />
                      <span>
                        <GeneratedValue value={o?.label ?? v} />
                      </span>
                      <GeneratedValue
                        value={
                          !off ? (
                            <button
                              type="button"
                              onClick={() => commit(ids.filter((x) => x !== v))}
                              className="text-slate-400 hover:text-red-600"
                              aria-label={tGenerated('m_101f98a70352fa', { value0: o?.label ?? v })}
                            >
                              <X size={12} />
                            </button>
                          ) : null
                        }
                      />
                    </li>
                  )
                })}
              />
            </ul>
          ) : (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              <GeneratedValue value={emptyLabel} />
            </p>
          )
        }
      />
      <GeneratedValue
        value={
          !off ? (
            <SearchSelect
              value=""
              onChange={(next) => {
                if (next && !ids.includes(next)) commit([...ids, next])
              }}
              options={available.map((o) => ({ value: o.value, label: o.label }))}
              placeholder={tGeneratedValue(placeholder)}
              searchPlaceholder={tGeneratedValue(searchPlaceholder)}
              sheetTitle={sheetTitle ?? label}
              ariaLabel={`Add ${label}`}
            />
          ) : null
        }
      />
      <RecordFieldError error={f.error} />
    </div>
  )
}
