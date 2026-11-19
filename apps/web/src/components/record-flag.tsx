'use client'

// A record's state flag (critical injury, locked, revoked, overdue, …) as a
// small pill in the header's badge row instead of a full-width alert. Record
// pages are forms people fill in on phones and tablets — header height is
// working space. Tapping the pill opens the full explanation and any action
// (e.g. Unlock) in a popover.

import { useState, type ReactNode } from 'react'
import { AlertTriangle, Info, Lock } from 'lucide-react'
import { cn, Popover } from '@beaconhs/ui'
import { GeneratedValue, useGeneratedValueTranslations } from '@/i18n/generated'

type FlagTone = 'danger' | 'caution' | 'info' | 'locked'

const TONE_CLASS: Record<FlagTone, string> = {
  danger:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
  caution:
    'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300',
  locked:
    'border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
}

const TONE_ICON: Record<FlagTone, ReactNode> = {
  danger: <AlertTriangle size={12} aria-hidden />,
  caution: <AlertTriangle size={12} aria-hidden />,
  info: <Info size={12} aria-hidden />,
  locked: <Lock size={12} aria-hidden />,
}

export function RecordFlag({
  tone,
  label,
  children,
}: {
  tone: FlagTone
  /** Two or three words: what is true about the record. */
  label: string
  /** The explanation, and any action, shown when the flag is tapped. */
  children?: ReactNode
}) {
  const t = useGeneratedValueTranslations()
  const [open, setOpen] = useState(false)
  const pill = cn(
    'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium whitespace-nowrap',
    TONE_CLASS[tone],
  )
  if (!children) {
    return (
      <span className={pill}>
        {TONE_ICON[tone]}
        <GeneratedValue value={label} />
      </span>
    )
  }
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      keepMounted
      ariaLabel={t(label)}
      className="w-72 p-3 text-sm text-slate-700 dark:text-slate-200"
      trigger={
        <button
          type="button"
          className={cn(pill, 'cursor-pointer hover:brightness-95')}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {TONE_ICON[tone]}
          <GeneratedValue value={label} />
        </button>
      }
    >
      <div className="space-y-2">
        <GeneratedValue value={children} />
      </div>
    </Popover>
  )
}
