'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown } from 'lucide-react'
import { cn, Popover } from '@beaconhs/ui'
import { mergeHref } from '@/lib/list-params'

export type FilterOption = { value: string; label: string; count?: number }

/**
 * Single-select filter rendered as a compact dropdown button. Collapses a
 * whole row of chips into one pill that shows the active selection inline, so
 * several filters + the search box fit on one toolbar row. Selecting an option
 * navigates (the param lives in the URL, same as before) — capability is
 * identical to the old chip row, just far denser.
 */
export function FilterChips({
  basePath,
  currentParams,
  paramKey,
  label,
  options,
  allLabel = 'All',
}: {
  basePath: string
  currentParams: Record<string, string | string[] | undefined>
  paramKey: string
  label: string
  options: FilterOption[]
  allLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const current =
    typeof currentParams[paramKey] === 'string' ? (currentParams[paramKey] as string) : undefined
  const active = options.find((o) => o.value === current)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      className="min-w-[13rem] p-1"
      trigger={
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'inline-flex h-8 max-w-[16rem] items-center gap-1.5 rounded-md border px-3 text-sm transition-colors',
            active
              ? 'border-teal-300 bg-teal-50 dark:bg-teal-950/50 text-teal-800 dark:text-teal-300'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800/60',
          )}
        >
          <span className={cn('shrink-0', active ? 'text-teal-700/70 dark:text-teal-300' : 'text-slate-500 dark:text-slate-400')}>
            {active ? `${label}:` : label}
          </span>
          {active ? <span className="truncate font-semibold">{active.label}</span> : null}
          <ChevronDown
            size={14}
            className={cn(
              'ml-auto shrink-0 transition-transform',
              open && 'rotate-180',
              active ? 'text-teal-500' : 'text-slate-400 dark:text-slate-500',
            )}
          />
        </button>
      }
    >
      <div className="max-h-72 overflow-auto" role="listbox">
        <FilterItem
          href={mergeHref(basePath, currentParams, { [paramKey]: undefined, page: 1 })}
          active={!current}
          onSelect={() => setOpen(false)}
        >
          {allLabel}
        </FilterItem>
        {options.map((opt) => (
          <FilterItem
            key={opt.value}
            href={mergeHref(basePath, currentParams, { [paramKey]: opt.value, page: 1 })}
            active={current === opt.value}
            count={opt.count}
            onSelect={() => setOpen(false)}
          >
            {opt.label}
          </FilterItem>
        ))}
      </div>
    </Popover>
  )
}

function FilterItem({
  href,
  active,
  count,
  onSelect,
  children,
}: {
  href: string
  active: boolean
  count?: number
  onSelect: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      href={href as any}
      onClick={onSelect}
      role="option"
      aria-selected={active}
      className={cn(
        'flex items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
        active ? 'bg-teal-50 dark:bg-teal-950/50 font-medium text-teal-800 dark:text-teal-300' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60',
      )}
    >
      <Check size={14} className={cn('shrink-0', active ? 'text-teal-600' : 'text-transparent')} />
      <span className="flex-1 truncate">{children}</span>
      {typeof count === 'number' ? (
        <span
          className={cn(
            'shrink-0 text-xs tabular-nums',
            active ? 'text-teal-600' : 'text-slate-400 dark:text-slate-500',
          )}
        >
          {count}
        </span>
      ) : null}
    </Link>
  )
}
