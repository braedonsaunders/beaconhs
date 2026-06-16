'use client'

// Progress-vs-goal renderer. Uses the first measure as the value; a percentage
// measure is shown directly, otherwise value/goal drives the bar. Dark-mode aware.

import { cn } from '@beaconhs/ui'
import type { FlatResult, VizSettings } from '@beaconhs/analytics'

export function ProgressCard({
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
  const measure = measures.find((m) => m.key === valueKey)
  const goal = settings.goal as number | undefined
  const raw = valueKey ? result.rows[0]?.[valueKey] : null
  const value = typeof raw === 'number' ? raw : Number(raw)

  let pct: number | null = null
  if (Number.isFinite(value)) {
    if (measure?.semanticType === 'percentage') pct = value
    else if (typeof goal === 'number' && goal > 0) pct = (value / goal) * 100
    else pct = value
  }
  const clamped = pct == null ? 0 : Math.max(0, Math.min(100, pct))
  const tone = clamped >= 80 ? 'bg-teal-500' : clamped >= 50 ? 'bg-amber-500' : 'bg-rose-500'

  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className="truncate text-xs font-medium tracking-wide text-slate-400 uppercase dark:text-slate-500">
        {label ?? measure?.label ?? 'Progress'}
      </span>
      <div>
        <div className="mb-1.5 text-3xl font-bold text-slate-900 tabular-nums dark:text-slate-100">
          {pct == null ? '—' : `${Math.round(pct)}%`}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={cn('h-full rounded-full', tone)} style={{ width: `${clamped}%` }} />
        </div>
      </div>
    </div>
  )
}
