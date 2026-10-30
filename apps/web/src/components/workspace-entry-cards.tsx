import { relativeTime } from '@/app/(app)/journals/_format'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  FileCheck2,
  NotebookPen,
  ShieldAlert,
} from 'lucide-react'
import { cn } from '@beaconhs/ui'
import { GeneratedValue } from '@/i18n/generated'
import type { WorkspaceEntry } from '@/lib/workspace-history'
import { formatDateTime } from '@/lib/datetime'
import type { AppLocale } from '@beaconhs/i18n'

const META = {
  journal: {
    label: 'Journal',
    icon: NotebookPen,
    tone: 'text-teal-700 bg-teal-100 dark:text-teal-300 dark:bg-teal-950/60',
  },
  hazard_assessment: {
    label: 'Hazard assessment',
    icon: ShieldAlert,
    tone: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-950/60',
  },
  incident: {
    label: 'Incident',
    icon: AlertTriangle,
    tone: 'text-rose-700 bg-rose-100 dark:text-rose-300 dark:bg-rose-950/60',
  },
  inspection: {
    label: 'Inspection',
    icon: ClipboardCheck,
    tone: 'text-sky-700 bg-sky-100 dark:text-sky-300 dark:bg-sky-950/60',
  },
  document: {
    label: 'Document acknowledgment',
    icon: FileCheck2,
    tone: 'text-indigo-700 bg-indigo-100 dark:text-indigo-300 dark:bg-indigo-950/60',
  },
}
export function WorkspaceEntryCards({
  entries,
  action,
  timezone,
  locale,
}: {
  entries: WorkspaceEntry[]
  action: 'Resume' | 'View record'
  timezone: string
  locale: AppLocale
}) {
  return (
    <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
      {entries.map((entry) => {
        const meta = META[entry.kind]
        const body = (
          <>
            <meta.icon
              aria-hidden
              strokeWidth={1.5}
              className="pointer-events-none absolute -right-6 -bottom-7 h-32 w-32 -rotate-12 text-slate-500/10 dark:text-slate-400/15"
            />
            <div className="relative flex h-full flex-col">
              <span
                className={cn(
                  'inline-flex w-fit items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium',
                  meta.tone,
                )}
              >
                <meta.icon size={14} />
                <GeneratedValue value={meta.label} />
              </span>
              <div className="mt-4 line-clamp-3 text-base font-semibold text-slate-900 dark:text-slate-100">
                <GeneratedValue value={entry.title} />
              </div>
              <time
                dateTime={entry.updatedAt}
                className="mt-2 text-xs text-slate-500 dark:text-slate-400"
              >
                {action === 'Resume'
                  ? relativeTime(entry.updatedAt, locale)
                  : formatDateTime(new Date(entry.updatedAt), timezone, locale)}
              </time>
              {entry.detail ? (
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {entry.detail.split(' · ').map((part, i) => (
                    <span key={i}>
                      {i > 0 ? ' · ' : ''}
                      <GeneratedValue value={part} />
                    </span>
                  ))}
                </div>
              ) : null}
              {entry.href ? (
                <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-teal-700 dark:text-teal-300">
                  <GeneratedValue value={action} />
                  <ArrowRight size={14} />
                </span>
              ) : null}
            </div>
          </>
        )
        const className =
          'group relative flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'
        return entry.href ? (
          <Link
            key={`${entry.kind}-${entry.id}`}
            href={entry.href as never}
            prefetch={false}
            className={className}
          >
            {body}
          </Link>
        ) : (
          <div key={`${entry.kind}-${entry.id}`} className={className}>
            {body}
          </div>
        )
      })}
    </div>
  )
}
