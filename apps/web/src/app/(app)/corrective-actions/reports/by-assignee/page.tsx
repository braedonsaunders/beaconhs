import Link from 'next/link'
import { Users } from 'lucide-react'
import { asc, count, eq, sql } from 'drizzle-orm'
import { Badge, EmptyState, PageHeader } from '@beaconhs/ui'
import {
  correctiveActions,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { CorrectiveActionsSubNav } from '@/components/corrective-actions-sub-nav'

export const metadata = { title: 'Corrective actions by assignee' }
export const dynamic = 'force-dynamic'

type AssigneeStat = {
  ownerId: string | null
  ownerName: string
  ownerEmail: string | null
  total: number
  open: number
  inProgress: number
  pendingVerification: number
  closed: number
  cancelled: number
  overdue: number
  completionRate: number
  avgDaysToClose: number | null
}

/**
 * Per-assignee scorecard. One row per owner with totals broken down by
 * status, an overdue count, a completion-rate ratio (closed ÷ total), and
 * the average days-to-close on resolved CAs. Sorted by most-loaded first.
 */
export default async function ByAssigneeReport() {
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const rows = await ctx.db((tx) =>
    tx
      .select({
        ownerId: correctiveActions.ownerTenantUserId,
        ownerDisplayName: tenantUsers.displayName,
        userName: user.name,
        userEmail: user.email,
        total: count().mapWith(Number),
        open: sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'open' THEN 1 ELSE 0 END)`.mapWith(Number),
        inProgress: sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'in_progress' THEN 1 ELSE 0 END)`.mapWith(Number),
        pendingVerification: sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'pending_verification' THEN 1 ELSE 0 END)`.mapWith(Number),
        closed: sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'closed' THEN 1 ELSE 0 END)`.mapWith(Number),
        cancelled: sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'cancelled' THEN 1 ELSE 0 END)`.mapWith(Number),
        overdue: sql<number>`SUM(CASE WHEN ${correctiveActions.dueOn} < ${today}::date AND ${correctiveActions.status} IN ('open','in_progress','pending_verification') THEN 1 ELSE 0 END)`.mapWith(Number),
        avgDaysToClose: sql<number | null>`AVG(CASE WHEN ${correctiveActions.closedAt} IS NOT NULL AND ${correctiveActions.assignedOn} IS NOT NULL THEN EXTRACT(EPOCH FROM (${correctiveActions.closedAt} - ${correctiveActions.assignedOn}::timestamp)) / 86400.0 ELSE NULL END)`,
      })
      .from(correctiveActions)
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .groupBy(
        correctiveActions.ownerTenantUserId,
        tenantUsers.displayName,
        user.name,
        user.email,
      )
      .orderBy(sql`COUNT(*) DESC`),
  )

  const stats: AssigneeStat[] = rows.map((r) => {
    const total = Number(r.total ?? 0)
    const closed = Number(r.closed ?? 0)
    const denom = total - Number(r.cancelled ?? 0)
    const completionRate = denom > 0 ? closed / denom : 0
    const avg = r.avgDaysToClose !== null ? Number(r.avgDaysToClose) : null
    return {
      ownerId: r.ownerId,
      ownerName: r.userName ?? r.ownerDisplayName ?? 'Unassigned',
      ownerEmail: r.userEmail ?? null,
      total,
      open: Number(r.open ?? 0),
      inProgress: Number(r.inProgress ?? 0),
      pendingVerification: Number(r.pendingVerification ?? 0),
      closed,
      cancelled: Number(r.cancelled ?? 0),
      overdue: Number(r.overdue ?? 0),
      completionRate,
      avgDaysToClose: avg !== null && Number.isFinite(avg) ? Math.round(avg * 10) / 10 : null,
    }
  })

  const totalCAs = stats.reduce((acc, s) => acc + s.total, 0)
  const totalOverdue = stats.reduce((acc, s) => acc + s.overdue, 0)

  return (
    <ListPageLayout
      header={
        <>
          <CorrectiveActionsSubNav active="by-assignee" />
          <PageHeader
            title="Corrective actions by assignee"
            description="Per-owner workload + completion rate + average days-to-close."
            back={{ href: '/corrective-actions', label: 'Back to records' }}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">{stats.length} assignees</Badge>
            <Badge variant="secondary">{totalCAs} total CAs</Badge>
            {totalOverdue > 0 ? (
              <Badge variant="destructive">{totalOverdue} overdue</Badge>
            ) : null}
          </div>
        </>
      }
    >
      {stats.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title="No corrective actions yet"
          description="Create some corrective actions and assign owners to populate this scorecard."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2 text-right">Total</th>
                <th className="px-4 py-2 text-right">Open</th>
                <th className="px-4 py-2 text-right">In progress</th>
                <th className="px-4 py-2 text-right">Pending verif.</th>
                <th className="px-4 py-2 text-right">Closed</th>
                <th className="px-4 py-2 text-right">Overdue</th>
                <th className="px-4 py-2 text-right">Completion</th>
                <th className="px-4 py-2 text-right">Avg days to close</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {stats.map((s) => (
                <tr key={s.ownerId ?? 'unassigned'} className="hover:bg-slate-50/50">
                  <td className="px-4 py-2">
                    <div className="text-slate-900">
                      {s.ownerId ? (
                        <Link
                          href={
                            `/corrective-actions?owner=${s.ownerId}` as any
                          }
                          className="font-medium hover:underline"
                        >
                          {s.ownerName}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-600">Unassigned</span>
                      )}
                    </div>
                    {s.ownerEmail ? (
                      <div className="text-xs text-slate-500">{s.ownerEmail}</div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{s.total}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{s.open}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{s.inProgress}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {s.pendingVerification}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-emerald-700">
                    {s.closed}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono text-xs ${s.overdue > 0 ? 'font-medium text-red-700' : ''}`}
                  >
                    {s.overdue}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <CompletionBar value={s.completionRate} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-slate-700">
                    {s.avgDaysToClose ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </ListPageLayout>
  )
}

function CompletionBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone =
    pct >= 80
      ? 'bg-emerald-500'
      : pct >= 50
        ? 'bg-amber-500'
        : 'bg-red-500'
  return (
    <div className="inline-flex w-32 items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-slate-600">{pct}%</span>
    </div>
  )
}
