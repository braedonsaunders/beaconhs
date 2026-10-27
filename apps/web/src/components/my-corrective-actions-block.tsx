import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@beaconhs/ui'
import type { MyCorrectiveActionsSummary } from '@/lib/my-corrective-actions'

/**
 * "My corrective actions" — open CAs assigned to the signed-in member.
 * Rendered as its own block (never counted in any compliance percent) on
 * /compliance/mine; the dashboard widget renders the same payload inline.
 */
export function MyCorrectiveActionsBlock({
  data,
  todayIso,
}: {
  data: MyCorrectiveActionsSummary
  todayIso: string
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          <GeneratedText id="m_1aa4d05fdb9565" />
        </h2>
        <Link
          href="/my/tasks"
          className="inline-flex items-center gap-1 text-sm font-medium text-teal-700 hover:underline dark:text-teal-300"
        >
          <GeneratedText id="m_099da529c61580" />
          <ChevronRight size={14} />
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <span>
          <GeneratedValue value={`${data.total} open`} />
        </span>
        <GeneratedValue
          value={
            data.overdue > 0 ? (
              <Badge variant="destructive">
                <GeneratedValue value={`${data.overdue} overdue`} />
              </Badge>
            ) : null
          }
        />
        <GeneratedValue
          value={
            data.dueSoon > 0 ? (
              <Badge variant="warning">
                <GeneratedValue value={`${data.dueSoon} due soon`} />
              </Badge>
            ) : null
          }
        />
      </div>
      <GeneratedValue
        value={
          data.items.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              <GeneratedText id="m_01baf77931cc70" />
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-slate-800">
              {data.items.map((item) => {
                const overdue = item.dueOn !== null && item.dueOn < todayIso
                return (
                  <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        <Link href={`/corrective-actions/${item.id}`} className="hover:underline">
                          <GeneratedValue value={item.title} />
                        </Link>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        <GeneratedValue value={item.reference} />
                        <GeneratedValue value={item.dueOn ? ` · due ${item.dueOn}` : ''} />
                      </div>
                    </div>
                    <GeneratedValue
                      value={
                        overdue ? (
                          <Badge variant="destructive" className="shrink-0">
                            <GeneratedText id="m_1e40bdcf2d1ba1" />
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="shrink-0">
                            <GeneratedValue value={item.status.replace('_', ' ')} />
                          </Badge>
                        )
                      }
                    />
                  </li>
                )
              })}
            </ul>
          )
        }
      />
    </section>
  )
}
