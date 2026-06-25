// Shared presentational bits for the compliance hub. Pure UI — no data logic.

import { Badge } from '@beaconhs/ui'

export function StatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge variant="success">Completed</Badge>
  if (status === 'overdue') return <Badge variant="destructive">Overdue</Badge>
  if (status === 'expiring') return <Badge variant="destructive">Expiring</Badge>
  if (status === 'in_progress') return <Badge variant="warning">In progress</Badge>
  if (status === 'waived' || status === 'not_applicable')
    return <Badge variant="secondary">N/A</Badge>
  return <Badge variant="secondary">Pending</Badge>
}

export function PercentBar({ percent, large = false }: { percent: number; large?: boolean }) {
  const tone = percent >= 80 ? 'bg-green-500' : percent >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div
      className={`relative w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800 ${large ? 'h-3' : 'h-2'}`}
    >
      <div
        className={`absolute inset-y-0 left-0 ${tone}`}
        style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
      />
    </div>
  )
}

export function SummaryStrip({
  percent,
  totals,
  title,
}: {
  percent: number
  totals: { total: number; completed: number; overdue: number; pending: number }
  title: string
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm text-slate-500 dark:text-slate-400">{title}</div>
          <div className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
            {percent}%
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {totals.completed} of {totals.total} completed · {totals.overdue} overdue ·{' '}
            {totals.pending} pending
          </div>
        </div>
        <div className="w-1/2 max-w-xl">
          <PercentBar percent={percent} large />
        </div>
      </div>
    </div>
  )
}

export function AgingCell({ count, tone }: { count: number; tone: 'warning' | 'danger' }) {
  if (count === 0) return <span className="text-slate-400">0</span>
  return <Badge variant={tone === 'danger' ? 'destructive' : 'warning'}>{count}</Badge>
}
