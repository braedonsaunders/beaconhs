import type { AppLocale } from '@beaconhs/i18n'
import { formatDate } from '@/lib/datetime'
import { GeneratedValue } from '@/i18n/generated'
import { PercentBar } from './_shared'

/** Average individual progress, so one person's extra journals cannot cover another. */
export function journalProgressPercent(
  rows: readonly { count?: number; expected?: number }[],
): number {
  if (!rows.length) return 0
  return Math.round(
    (rows.reduce(
      (sum, row) => sum + Math.min(1, Math.max(0, row.count ?? 0) / Math.max(1, row.expected ?? 1)),
      0,
    ) /
      rows.length) *
      100,
  )
}

export function JournalProgress({
  count,
  expected,
  met = false,
}: {
  count: number
  expected: number
  met?: boolean
}) {
  return (
    <div className="max-w-56 min-w-28 space-y-1">
      <div className="text-sm tabular-nums">
        <GeneratedValue value={count} /> / <GeneratedValue value={expected} />{' '}
        <GeneratedValue value="submitted" />
      </div>
      <PercentBar percent={Math.min(100, (count / Math.max(1, expected)) * 100)} progress />
      {met && count < expected ? (
        <div className="text-xs text-slate-500">
          <GeneratedValue value="Minimum met" />
        </div>
      ) : null}
    </div>
  )
}

export function JournalPeriod({
  start,
  end,
  locale,
}: {
  start: string
  end: string
  locale: AppLocale
}) {
  return (
    <span className="text-xs text-slate-500 dark:text-slate-400">
      {formatDate(new Date(`${start}T00:00:00Z`), 'UTC', locale)} –{' '}
      {formatDate(new Date(`${end}T00:00:00Z`), 'UTC', locale)}
    </span>
  )
}
