import { Activity, Check, Pencil, Plus, Signature, Trash2 } from 'lucide-react'

export type ActivityEntry = {
  id: string
  action: string
  summary?: string | null
  actor?: string | null
  occurredAt: Date | string
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
}

const ACTION_ICONS: Record<string, { icon: typeof Activity; tone: string }> = {
  create: { icon: Plus, tone: 'bg-emerald-100 text-emerald-700' },
  update: { icon: Pencil, tone: 'bg-amber-100 text-amber-700' },
  delete: { icon: Trash2, tone: 'bg-red-100 text-red-700' },
  sign: { icon: Signature, tone: 'bg-teal-100 text-teal-700' },
  publish: { icon: Check, tone: 'bg-teal-100 text-teal-700' },
}

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        No activity recorded yet.
      </div>
    )
  }
  return (
    <ol className="relative space-y-3 pl-6">
      <span className="absolute left-2.5 top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-700" aria-hidden />
      {entries.map((e) => {
        const meta = ACTION_ICONS[e.action] ?? { icon: Activity, tone: 'bg-slate-100 text-slate-600' }
        const Icon = meta.icon
        return (
          <li key={e.id} className="relative">
            <span
              className={`absolute -left-6 top-0 flex h-5 w-5 items-center justify-center rounded-full ${meta.tone}`}
            >
              <Icon size={11} />
            </span>
            <div className="rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900 dark:text-slate-100">
                  {e.summary ?? humanise(e.action)}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{formatRel(e.occurredAt)}</span>
              </div>
              {e.actor ? <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">by {e.actor}</div> : null}
              {e.after && Object.keys(e.after).length > 0 ? (
                <details className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                  <summary className="cursor-pointer select-none text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                    show changes
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 dark:bg-slate-900 p-2 text-[11px] text-slate-700 dark:text-slate-200">
                    {JSON.stringify(e.after, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function humanise(action: string): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatRel(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const ms = Date.now() - date.getTime()
  const mins = Math.round(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString()
}
