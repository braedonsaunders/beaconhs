'use client'

// Single-select person/user picker for server-rendered forms. Wraps the
// SearchSelect typeahead from @beaconhs/ui and mirrors the chosen id into a
// hidden <input name>, so it drops straight into existing server-action forms
// with no field-contract change. Use this in place of a native <select> of
// people once the candidate list can exceed ~20 entries. Pass `hint` on each
// option (employee no. or email) to disambiguate duplicate display names.
//
// Note: if `defaultValue` references a person who is not in `options` (e.g. an
// assignment to someone since made inactive), the chosen id is still preserved
// and posted; only the visible label falls back to the placeholder.

import { useState } from 'react'
import { SearchSelect, type SelectOption } from '@beaconhs/ui'

export function PersonSelectField({
  name,
  options,
  defaultValue = '',
  placeholder = 'Select a person...',
  searchPlaceholder = 'Search people...',
  sheetTitle = 'Select a person',
  ariaLabel,
  clearable = true,
  emptyLabel = 'None',
  disabled = false,
  className,
}: {
  name: string
  options: SelectOption[]
  defaultValue?: string
  placeholder?: string
  searchPlaceholder?: string
  sheetTitle?: string
  ariaLabel?: string
  /** Adds a leading "None" option so the field can be cleared. Default true. */
  clearable?: boolean
  emptyLabel?: string
  disabled?: boolean
  className?: string
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <>
      <input type="hidden" name={name} value={value} />
      <SearchSelect
        value={value}
        onChange={setValue}
        options={options}
        placeholder={placeholder}
        searchPlaceholder={searchPlaceholder}
        sheetTitle={sheetTitle}
        ariaLabel={ariaLabel ?? placeholder}
        clearable={clearable}
        emptyLabel={emptyLabel}
        disabled={disabled}
        className={className}
      />
    </>
  )
}
