import Link from 'next/link'
import { AlertTriangle, Clock } from 'lucide-react'
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { Badge, EmptyState, PageHeader } from '@beaconhs/ui'
import { correctiveActions, orgUnits, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { ListPageLayout } from '@/components/page-layout'
import { CorrectiveActionsSubNav } from '@/components/corrective-actions-sub-nav'

export const metadata = { title: 'Overdue corrective actions' }
export const dynamic = 'force-dynamic'

type AssigneeGroup = {
  ownerTenantUserId: string | null
  ownerName: string
  ownerEmail: string | null
  rows: {
    id: string
    reference: string
    title: string
    severity: 'low' | 'medium' | 'high' | 'critical'
    status: 'open' | 'in_progress' | 'pending_verification' | 'closed' | 'cancelled'
    dueOn: string | null
    daysOverdue: number
    siteName: string | null
  }[]
}

/**
 * Overdue report — every open / in-progress / pending-verification CA whose
 * dueOn is before today, grouped by owner so a manager can see who's behind.
 */
export default async function OverdueReport() {
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const rows = await ctx.db(async (tx) => {
    // Per-user record visibility — same predicate as the /corrective-actions
    // list page, so a self/site-tier user only sees their slice here too.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    return tx
      .select({
        ca: correctiveActions,
        site: orgUnits,
        owner: tenantUsers,
        ownerAccount: user,
      })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(
        and(
          isNull(correctiveActions.deletedAt),
          lt(correctiveActions.dueOn, today),
          inArray(correctiveActions.status, ['open', 'in_progress', 'pending_verification']),
          vis,
        ),
      )
      .orderBy(asc(correctiveActions.dueOn))
  })

  const groups: AssigneeGroup[] = []
  const byOwner = new Map<string, AssigneeGroup>()
  for (const r of rows) {
    const key = r.owner?.id ?? '__unassigned__'
    let g = byOwner.get(key)
    if (!g) {
      g = {
        ownerTenantUserId: r.owner?.id ?? null,
        ownerName: r.ownerAccount?.name ?? r.owner?.displayName ?? 'Unassigned',
        ownerEmail: r.ownerAccount?.email ?? null,
        rows: [],
      }
      byOwner.set(key, g)
      groups.push(g)
    }
    const daysOverdue = r.ca.dueOn ? diffDays(r.ca.dueOn, today) : 0
    g.rows.push({
      id: r.ca.id,
      reference: r.ca.reference,
      title: r.ca.title,
      severity: r.ca.severity,
      status: r.ca.status,
      dueOn: r.ca.dueOn,
      daysOverdue,
      siteName: r.site?.name ?? null,
    })
  }
  groups.sort((a, b) => b.rows.length - a.rows.length)

  const totalCount = rows.length

  return (
    <ListPageLayout
      header={
        <>
          <CorrectiveActionsSubNav active="overdue" />
          <PageHeader
            title="Overdue corrective actions"
            description="Open work past its due date, grouped by the person on the hook."
            back={{ href: '/corrective-actions', label: 'Back to records' }}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="destructive">
              <AlertTriangle size={10} className="mr-1" /> {totalCount} overdue
            </Badge>
            <Badge variant="secondary">{groups.length} owners affected</Badge>
          </div>
        </>
      }
    >
      {totalCount === 0 ? (
        <EmptyState
          icon={<Clock size={32} />}
          title="Nothing overdue"
          description="Every open corrective action is still inside its due window. Nice."
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <section
              key={g.ownerTenantUserId ?? 'unassigned'}
              className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
            >
              <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/60 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900/80">
                <div>
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {g.ownerName}
                  </div>
                  {g.ownerEmail ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400">{g.ownerEmail}</div>
                  ) : null}
                </div>
                <Badge variant="destructive">{g.rows.length} overdue</Badge>
              </header>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
                    <th className="px-4 py-2">Ref</th>
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Severity</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Due</th>
                    <th className="px-4 py-2">Days overdue</th>
                    <th className="px-4 py-2">Site</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {g.rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60">
                      <td className="px-4 py-2 font-mono text-xs">
                        <Link
                          href={`/corrective-actions/${r.id}` as any}
                          className="hover:underline"
                        >
                          {r.reference}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <Link
                          href={`/corrective-actions/${r.id}` as any}
                          className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                        >
                          {r.title}
                        </Link>
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant={
                            r.severity === 'critical' || r.severity === 'high'
                              ? 'destructive'
                              : r.severity === 'medium'
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {r.severity}
                        </Badge>
                      </td>
                      <td className="px-4 py-2">
                        <Badge variant="warning">{r.status.replace('_', ' ')}</Badge>
                      </td>
                      <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                        {r.dueOn ?? '—'}
                      </td>
                      <td className="px-4 py-2 font-medium text-red-700 dark:text-red-400">
                        {r.daysOverdue}
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                        {r.siteName ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </ListPageLayout>
  )
}

function diffDays(dueIso: string, todayIso: string): number {
  const due = Date.parse(dueIso)
  const today = Date.parse(todayIso)
  if (!Number.isFinite(due) || !Number.isFinite(today)) return 0
  return Math.max(0, Math.round((today - due) / 86_400_000))
}
