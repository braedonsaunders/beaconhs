'use client'

// KPI / number renderer — the big-figure scalar. Optional period-over-period
// delta when a second measure (compare) is present. Dark-mode aware.

import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { cn } from '@beaconhs/ui'
import type { FlatResult, VizSettings } from '@beaconhs/analytics'

function format(v: unknown, decimals: number | undefined, prefix: string, suffix: string): string {
  if (v === null || typeof v === 'undefined') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  const body =
    typeof decimals === 'number'
      ? n.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })
      : n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return `${prefix}${body}${suffix}`
}

export function ScalarCard({
  result,
  settings = {},
  label,
}: {
  result: FlatResult
  settings?: VizSettings
  label?: string
}) {
  const measures = result.columns.filter((c) => c.role === 'measure')
  const valueKey = (settings.valueField as string) || measures[0]?.key
  // Only show a delta when the user EXPLICITLY picks a compare field — never
  // auto-fall back to the 2nd measure (which is usually an unrelated count, e.g.
  // comparing an 84% rate against the 912 "completed" tally → a nonsense ↓827).
  const compareKey = (settings.compareField as string) || undefined
  const valueCol = measures.find((m) => m.key === valueKey)
  const isPct = valueCol?.semanticType === 'percentage'
  const decimals = (settings.decimals as number | undefined) ?? (isPct ? 0 : undefined)
  const prefix = (settings.prefix as string) || ''
  // A percentage measure defaults to a "%" suffix; an explicit setting (even "")
  // always wins so the builder can override it.
  const suffix = settings.suffix !== undefined ? String(settings.suffix) : isPct ? '%' : ''

  const row = result.rows[0] ?? {}
  const value = valueKey ? row[valueKey] : null
  const compare = compareKey ? row[compareKey] : null
  const delta = typeof value === 'number' && typeof compare === 'number' ? value - compare : null
  const measureLabel = valueCol?.label

  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className="truncate text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
        {label ?? measureLabel ?? 'Value'}
      </span>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
          {format(value, decimals, prefix, suffix)}
        </span>
        {value == null ? (
          <span className="mb-1 text-xs font-medium text-slate-400 dark:text-slate-500">
            No data
          </span>
        ) : delta != null && delta !== 0 ? (
          <span
            className={cn(
              'mb-1 inline-flex items-center text-xs font-medium',
              delta >= 0 ? 'text-teal-600 dark:text-teal-400' : 'text-rose-500 dark:text-rose-400',
            )}
          >
            {delta > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
            {Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </span>
        ) : null}
      </div>
    </div>
  )
}
