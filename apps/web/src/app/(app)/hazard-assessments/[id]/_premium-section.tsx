'use client'

import { useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@beaconhs/ui'

type Tone = 'slate' | 'blue' | 'purple' | 'teal' | 'amber' | 'indigo' | 'emerald'

const TONE: Record<Tone, string> = {
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300',
  teal: 'bg-teal-100 text-teal-700 dark:bg-teal-950/50 dark:text-teal-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300',
  indigo: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300',
}

/**
 * Premium collapsible section card for the hazard-assessment detail page.
 * Drop-in superset of the shared <Section>: same base props (title, subtitle,
 * actions, defaultOpen, children) plus an optional icon chip, tone, count pill,
 * and "done" badge. Bigger radius, soft shadow, richer header — at all widths.
 */
export function PremiumSection({
  title,
  subtitle,
  actions,
  icon,
  tone = 'slate',
  count,
  done,
  defaultOpen = true,
  children,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
  icon?: React.ReactNode
  tone?: Tone
  count?: number
  done?: boolean
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center gap-3 p-4 sm:gap-4 sm:p-5">
        {icon ? (
          <span
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
              TONE[tone],
            )}
          >
            {icon}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
          aria-expanded={open}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-base font-semibold text-slate-900 sm:text-[17px] dark:text-slate-100">
                {title}
              </h2>
              {typeof count === 'number' ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {count}
                </span>
              ) : null}
              {done ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <Check size={11} /> Done
                </span>
              ) : null}
            </div>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">
                {subtitle}
              </p>
            ) : null}
          </div>
          <ChevronDown
            size={18}
            className={cn(
              'shrink-0 text-slate-400 transition-transform dark:text-slate-500',
              open ? '' : '-rotate-90',
            )}
          />
        </button>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {open ? (
        <div className="border-t border-slate-100 p-4 sm:p-5 dark:border-slate-800">{children}</div>
      ) : null}
    </section>
  )
}
