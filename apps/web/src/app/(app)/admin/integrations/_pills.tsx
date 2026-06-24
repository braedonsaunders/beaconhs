// Shared presentational pills (no 'use client' — safe in server and client
// components). Used by the integrations hub list and the browse catalog.

import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import { cn } from '@beaconhs/ui'

export function DirectionPill({ dir }: { dir: 'in' | 'out' }) {
  const Icon = dir === 'in' ? ArrowDownToLine : ArrowUpFromLine
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1',
        dir === 'in'
          ? 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/30'
          : 'bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30',
      )}
    >
      <Icon size={11} />
      {dir === 'in' ? 'Sync in' : 'Push out'}
    </span>
  )
}

const STATUS_PILL: Record<string, string> = {
  connected:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  ready:
    'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30',
  draft:
    'bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-700',
  error:
    'bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30',
  disabled:
    'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
}

export function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        STATUS_PILL[status] ?? STATUS_PILL.draft,
      )}
    >
      {status}
    </span>
  )
}
