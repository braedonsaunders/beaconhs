import { GeneratedText, GeneratedValue } from '@/i18n/generated'
// Shared presentational bits for the compliance hub. Pure UI — no data logic.

import { Badge } from '@beaconhs/ui'

export function StatusBadge({ status }: { status: string }) {
  if (status === 'completed')
    return (
      <Badge variant="success">
        <GeneratedText id="m_0ba7a5e1b2fa32" />
      </Badge>
    )
  if (status === 'overdue')
    return (
      <Badge variant="destructive">
        <GeneratedText id="m_1e40bdcf2d1ba1" />
      </Badge>
    )
  if (status === 'expiring')
    return (
      <Badge variant="destructive">
        <GeneratedText id="m_101200f48a3e75" />
      </Badge>
    )
  if (status === 'in_progress')
    return (
      <Badge variant="warning">
        <GeneratedText id="m_1a03b06872ffd9" />
      </Badge>
    )
  if (status === 'waived' || status === 'not_applicable')
    return (
      <Badge variant="secondary">
        <GeneratedText id="m_06702e4064e393" />
      </Badge>
    )
  return (
    <Badge variant="secondary">
      <GeneratedText id="m_131b7246255b65" />
    </Badge>
  )
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
          <div className="truncate text-sm text-slate-500 dark:text-slate-400">
            <GeneratedValue value={title} />
          </div>
          <div className="text-3xl font-semibold text-slate-900 dark:text-slate-100">
            <GeneratedValue value={percent} />%
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            <GeneratedValue value={totals.completed} /> <GeneratedText id="m_00e704d1194796" />{' '}
            <GeneratedValue value={totals.total} /> <GeneratedText id="m_1be8875c860243" />{' '}
            <GeneratedValue value={totals.overdue} /> <GeneratedText id="m_063d287430621d" />
            <GeneratedValue value={' '} />
            <GeneratedValue value={totals.pending} /> <GeneratedText id="m_15ac663b8c57a6" />
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
  return (
    <Badge variant={tone === 'danger' ? 'destructive' : 'warning'}>
      <GeneratedValue value={count} />
    </Badge>
  )
}
