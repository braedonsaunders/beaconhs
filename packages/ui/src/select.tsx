'use client'

// Select — the app-wide select control. It looks and behaves like the
// SearchSelect typeahead (anchored dropdown on desktop, bottom sheet on mobile,
// searchable, keyboard nav, dark-mode) but keeps the *exact* native-<select>
// API: pass <option>/<optgroup> children, `value`/`onChange`, or
// `name`/`defaultValue` for server-action forms. A visually-hidden real
// <select> underneath carries the value, fires the genuine
// onChange(ChangeEvent<HTMLSelectElement>), and powers native form submission
// + `required` validation — so this is a drop-in replacement for a plain
// <select> with no field-contract change anywhere.
//
// There are intentionally NO native <select> dropdowns in the product; use this
// (or SearchSelect / PersonSelectField for fully-custom cases) everywhere.

import * as React from 'react'
import { SearchSelect } from './search-select'
import { parseNativeSelect, parseSelectChildren, selectChildrenEqual } from './select-options'
import { cn } from './utils'

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  /** Greyed placeholder shown when nothing is selected (or use a leading <option value=""> ). */
  placeholder?: string
  /** Title of the mobile bottom sheet. */
  sheetTitle?: string
  searchPlaceholder?: string
  /** Force the in-dropdown search box on/off. Defaults to auto (shown for long lists). */
  searchable?: boolean
  /** Extra classes for the trigger button (the visible control). */
  triggerClassName?: string
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    className,
    triggerClassName,
    children,
    value,
    defaultValue,
    onChange,
    placeholder,
    sheetTitle,
    searchPlaceholder,
    searchable,
    disabled,
    required,
    name,
    id,
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  const innerRef = React.useRef<HTMLSelectElement | null>(null)
  const setRef = React.useCallback(
    (el: HTMLSelectElement | null) => {
      innerRef.current = el
      if (typeof ref === 'function') ref(el)
      else if (ref) (ref as React.MutableRefObject<HTMLSelectElement | null>).current = el
    },
    [ref],
  )

  const isControlled = value !== undefined
  const [uncontrolled, setUncontrolled] = React.useState(
    defaultValue != null ? String(defaultValue) : '',
  )
  const current = isControlled ? String(value ?? '') : uncontrolled

  const childParsed = React.useMemo(() => parseSelectChildren(children), [children])
  const [parsed, setParsed] = React.useState(childParsed)

  // Option-producing components (translation helpers, field registries, and
  // conditional blocks) only become concrete <option> elements after React
  // renders the hidden select. Synchronize the visible typeahead from that
  // resolved DOM so its menu can never silently appear empty.
  React.useLayoutEffect(() => {
    const select = innerRef.current
    if (!select) return
    const resolved = parseNativeSelect(select)
    setParsed((current) => (selectChildrenEqual(current, resolved) ? current : resolved))
  }, [children])

  function handleNativeChange(e: React.ChangeEvent<HTMLSelectElement>) {
    if (!isControlled) setUncontrolled(e.currentTarget.value)
    onChange?.(e)
  }

  // Drive the hidden native <select> so the genuine change event fires (real
  // ChangeEvent for callers, native form value + validation stay intact).
  function pick(v: string) {
    const el = innerRef.current
    if (!el) return
    el.value = v
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const isInvalid = rest['aria-invalid'] === true || rest['aria-invalid'] === 'true'

  // Historically `className` styled the native <select> box itself, so callers
  // express height/text there as well as width/flex. Route it to the trigger
  // (height/text/width) and the wrapper (width/flex/layout) so both land.
  return (
    <span className={cn('relative block w-full', className)}>
      {/* Form/validation/onChange proxy — visually hidden, never tab-focused. */}
      <select
        {...rest}
        ref={setRef}
        name={name}
        required={required}
        disabled={disabled}
        aria-hidden
        tabIndex={-1}
        {...(isControlled ? { value: current } : { defaultValue })}
        onChange={handleNativeChange}
        className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
      >
        {children}
      </select>
      <SearchSelect
        id={id}
        value={current}
        onChange={pick}
        options={parsed.options}
        placeholder={placeholder ?? parsed.placeholder}
        searchPlaceholder={searchPlaceholder}
        sheetTitle={sheetTitle ?? placeholder ?? parsed.placeholder}
        ariaLabel={ariaLabel}
        clearable={parsed.clearable}
        emptyLabel={parsed.emptyLabel}
        disabled={disabled}
        searchable={searchable}
        invalid={isInvalid}
        triggerClassName={cn(className, triggerClassName)}
      />
    </span>
  )
})
Select.displayName = 'Select'
