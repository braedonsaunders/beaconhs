'use client'

import {
  useGeneratedTranslations,
  GeneratedValue,
  useGeneratedValueTranslations,
} from '@/i18n/generated'

import { X } from 'lucide-react'
import type { PickerLookup, PickerOption } from '@/lib/picker-options'
import { RemoteSearchSelect } from './remote-search-select'

export function RemoteMultiSelect({
  lookup,
  value,
  onChange,
  placeholder = 'Add…',
  searchPlaceholder = 'Search…',
  sheetTitle,
  ariaLabel,
  emptyLabel = 'None selected.',
  disabled = false,
  max = 20,
}: {
  lookup: PickerLookup
  value: PickerOption[]
  onChange: (next: PickerOption[]) => void
  placeholder?: string
  searchPlaceholder?: string
  sheetTitle?: string
  ariaLabel?: string
  emptyLabel?: string
  disabled?: boolean
  max?: number
}) {
  const tGeneratedValue = useGeneratedValueTranslations()
  const tGenerated = useGeneratedTranslations()
  const selectedIds = value.map((option) => option.value)
  const atLimit = value.length >= max

  return (
    <div className="space-y-2">
      <GeneratedValue
        value={
          value.length > 0 ? (
            <ul className="flex flex-wrap gap-2" aria-label={tGenerated('m_09655793ed5761')}>
              <GeneratedValue
                value={value.map((option) => (
                  <li
                    key={option.value}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-sm text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <span>
                      <GeneratedValue value={option.label} />
                    </span>
                    <GeneratedValue
                      value={
                        !disabled ? (
                          <button
                            type="button"
                            onClick={() =>
                              onChange(value.filter((item) => item.value !== option.value))
                            }
                            className="rounded-full p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-red-600 focus:ring-2 focus:ring-teal-500 focus:outline-none dark:hover:bg-slate-800"
                            aria-label={tGenerated('m_101f98a70352fa', { value0: option.label })}
                          >
                            <X size={12} />
                          </button>
                        ) : null
                      }
                    />
                  </li>
                ))}
              />
            </ul>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              <GeneratedValue value={emptyLabel} />
            </p>
          )
        }
      />

      <GeneratedValue
        value={
          !disabled ? (
            <RemoteSearchSelect
              lookup={lookup}
              value=""
              onChange={() => undefined}
              onOptionChange={(option) => {
                if (!option || selectedIds.includes(option.value) || atLimit) return
                onChange([...value, option])
              }}
              excludedValues={selectedIds}
              placeholder={tGeneratedValue(
                atLimit ? tGenerated('m_1f81c030949ccf', { value0: max }) : placeholder,
              )}
              searchPlaceholder={tGeneratedValue(searchPlaceholder)}
              sheetTitle={sheetTitle}
              ariaLabel={ariaLabel ?? placeholder}
              clearable={false}
              disabled={atLimit}
            />
          ) : null
        }
      />
    </div>
  )
}
