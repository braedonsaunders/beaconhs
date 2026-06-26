import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Badge, cn } from '@beaconhs/ui'

// Tone-coded summary tile — the workspace "ghost icon" treatment, extracted so
// list + detail pages share one look. Optionally a link (filters/drill-downs).

export type StatTone = 'rose' | 'amber' | 'teal' | 'violet' | 'sky' | 'emerald' | 'indigo' | 'slate'

const TONES: Record<StatTone, { chip: string; ghost: string }> = {
  rose: {
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
    ghost: 'text-rose-500/10 dark:text-rose-400/15',
  },
  amber: {
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
    ghost: 'text-amber-500/10 dark:text-amber-400/15',
  },
  teal: {
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300',
    ghost: 'text-teal-500/10 dark:text-teal-400/15',
  },
  violet: {
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
    ghost: 'text-violet-500/10 dark:text-violet-400/15',
  },
  sky: {
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
    ghost: 'text-sky-500/10 dark:text-sky-400/15',
  },
  emerald: {
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
    ghost: 'text-emerald-500/10 dark:text-emerald-400/15',
  },
  indigo: {
    chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
    ghost: 'text-indigo-500/10 dark:text-indigo-400/15',
  },
  slate: {
    chip: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
    ghost: 'text-slate-500/10 dark:text-slate-400/15',
  },
}

export function StatTile({
  icon: Icon,
  tone = 'slate',
  label,
  value,
  hint,
  hintVariant = 'secondary',
  href,
  compact = false,
  dense = false,
  className,
}: {
  icon: LucideIcon
  tone?: StatTone
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  hintVariant?: 'destructive' | 'warning' | 'success' | 'secondary' | 'outline'
  href?: string
  /** Smaller value text — use for dates / words rather than big counts. */
  compact?: boolean
  /**
   * Half-height layout: chip + value + label on one horizontal line, no ghost
   * icon. Use for compact KPI rows on detail pages.
   */
  dense?: boolean
  className?: string
}) {
  const t = TONES[tone]
  const body = dense ? (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
          t.chip,
        )}
      >
        <Icon size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-100">
            {value}
          </span>
          {hint != null ? (
            <Badge variant={hintVariant} className="shrink-0 font-normal">
              {hint}
            </Badge>
          ) : null}
        </div>
        <div className="truncate text-[11px] font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {label}
        </div>
      </div>
    </div>
  ) : (
    <>
      <Icon
        aria-hidden
        strokeWidth={1.5}
        className={cn(
          'pointer-events-none absolute -right-4 -bottom-5 h-24 w-24 -rotate-12 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6',
          t.ghost,
        )}
      />
      <div className="relative">
        <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-lg', t.chip)}>
          <Icon size={16} />
        </span>
        <div
          className={cn(
            'mt-2 font-semibold tracking-tight text-slate-900 tabular-nums dark:text-slate-100',
            compact ? 'text-base' : 'text-2xl',
          )}
        >
          {value}
        </div>
        <div className="mt-0.5 truncate text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {label}
        </div>
        {hint != null ? (
          <Badge variant={hintVariant} className="mt-2 font-normal">
            {hint}
          </Badge>
        ) : null}
      </div>
    </>
  )

  const base =
    'group relative block overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition-all dark:border-slate-800 dark:bg-slate-900'
  const pad = dense ? 'p-3' : 'p-3.5 sm:p-4'

  return href ? (
    <Link
      href={href as never}
      className={cn(base, pad, 'hover:-translate-y-0.5 hover:shadow-md', className)}
    >
      {body}
    </Link>
  ) : (
    <div className={cn(base, pad, className)}>{body}</div>
  )
}
