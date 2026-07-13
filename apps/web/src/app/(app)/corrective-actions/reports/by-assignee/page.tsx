import Link from 'next/link'
import { Users } from 'lucide-react'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { Badge, EmptyState, PageHeader } from '@beaconhs/ui'
import { correctiveActions, tenantUsers, users as user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { ListPageLayout } from '@/components/page-layout'
import { CorrectiveActionsSubNav } from '@/components/corrective-actions-sub-nav'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortTh } from '@/components/sortable-th'
import { TableToolbar } from '@/components/table-toolbar'
import { parseListParams, pickString } from '@/lib/list-params'

export const metadata = { title: 'Corrective actions by assignee' }
export const dynamic = 'force-dynamic'

const BASE = '/corrective-actions/reports/by-assignee'
const SORTS = ['owner', 'total', 'open', 'overdue', 'completion', 'average'] as const

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
export default async function ByAssigneeReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'total',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const attentionParam = pickString(sp.attention)
  const attentionFilter = ['overdue', 'outstanding', 'clear'].find(
    (attention) => attention === attentionParam,
  )
  const ctx = await requireRequestContext()
  const today = new Date().toISOString().slice(0, 10)

  const rows = await ctx.db(async (tx) => {
    // Per-user record visibility — same predicate as the /corrective-actions
    // list page, so a self/site-tier user only aggregates their slice here too.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    return tx
      .select({
        ownerId: correctiveActions.ownerTenantUserId,
        ownerDisplayName: tenantUsers.displayName,
        userName: user.name,
        userEmail: user.email,
        total: count().mapWith(Number),
        open: sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'open' THEN 1 ELSE 0 END)`.mapWith(
          Number,
        ),
        inProgress:
          sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'in_progress' THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        pendingVerification:
          sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'pending_verification' THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        closed:
          sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'closed' THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        cancelled:
          sql<number>`SUM(CASE WHEN ${correctiveActions.status} = 'cancelled' THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        overdue:
          sql<number>`SUM(CASE WHEN ${correctiveActions.dueOn} < ${today}::date AND ${correctiveActions.status} IN ('open','in_progress','pending_verification') THEN 1 ELSE 0 END)`.mapWith(
            Number,
          ),
        avgDaysToClose: sql<
          number | null
        >`AVG(CASE WHEN ${correctiveActions.closedAt} IS NOT NULL AND ${correctiveActions.assignedOn} IS NOT NULL THEN EXTRACT(EPOCH FROM (${correctiveActions.closedAt} - ${correctiveActions.assignedOn}::timestamp)) / 86400.0 ELSE NULL END)`,
      })
      .from(correctiveActions)
      .leftJoin(tenantUsers, eq(tenantUsers.id, correctiveActions.ownerTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(and(isNull(correctiveActions.deletedAt), vis))
      .groupBy(correctiveActions.ownerTenantUserId, tenantUsers.displayName, user.name, user.email)
      .orderBy(sql`COUNT(*) DESC`)
  })

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
  const query = params.q?.toLowerCase()
  const filtered = stats.filter((stat) => {
    const outstanding = stat.open + stat.inProgress + stat.pendingVerification
    if (attentionFilter === 'overdue' && stat.overdue === 0) return false
    if (attentionFilter === 'outstanding' && outstanding === 0) return false
    if (attentionFilter === 'clear' && outstanding > 0) return false
    if (!query) return true
    return [stat.ownerName, stat.ownerEmail ?? ''].join(' ').toLowerCase().includes(query)
  })
  const mult = params.dir === 'asc' ? 1 : -1
  filtered.sort((a, b) => {
    const comparison =
      params.sort === 'owner'
        ? a.ownerName.localeCompare(b.ownerName)
        : params.sort === 'open'
          ? a.open - b.open
          : params.sort === 'overdue'
            ? a.overdue - b.overdue
            : params.sort === 'completion'
              ? a.completionRate - b.completionRate
              : params.sort === 'average'
                ? (a.avgDaysToClose ?? Number.POSITIVE_INFINITY) -
                  (b.avgDaysToClose ?? Number.POSITIVE_INFINITY)
                : a.total - b.total
    return comparison * mult || a.ownerName.localeCompare(b.ownerName)
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / params.perPage))
  const page = Math.min(params.page, pageCount)
  const pageRows = filtered.slice((page - 1) * params.perPage, page * params.perPage)

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
            {totalOverdue > 0 ? <Badge variant="destructive">{totalOverdue} overdue</Badge> : null}
          </div>
          <TableToolbar>
            <SearchInput placeholder="Search owner or email…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="attention"
              label="Workload"
              options={[
                {
                  value: 'overdue',
                  label: 'Has overdue',
                  count: stats.filter((stat) => stat.overdue > 0).length,
                },
                {
                  value: 'outstanding',
                  label: 'Has outstanding',
                  count: stats.filter(
                    (stat) => stat.open + stat.inProgress + stat.pendingVerification > 0,
                  ).length,
                },
                {
                  value: 'clear',
                  label: 'No outstanding',
                  count: stats.filter(
                    (stat) => stat.open + stat.inProgress + stat.pendingVerification === 0,
                  ).length,
                },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {pageRows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title={stats.length === 0 ? 'No corrective actions yet' : 'No matching assignees'}
          description={
            stats.length === 0
              ? 'Create some corrective actions and assign owners to populate this scorecard.'
              : 'Adjust the search or workload filter.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="owner"
                >
                  Owner
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="total"
                  align="right"
                  className="text-right"
                >
                  Total
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="open"
                  align="right"
                  className="text-right"
                >
                  Open
                </SortTh>
                <th className="px-4 py-2 text-right">In progress</th>
                <th className="px-4 py-2 text-right">Pending verif.</th>
                <th className="px-4 py-2 text-right">Closed</th>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="overdue"
                  align="right"
                  className="text-right"
                >
                  Overdue
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="completion"
                  align="right"
                  className="text-right"
                >
                  Completion
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="average"
                  align="right"
                  className="text-right"
                >
                  Avg days to close
                </SortTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pageRows.map((s) => (
                <tr
                  key={s.ownerId ?? 'unassigned'}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
                >
                  <td className="px-4 py-2">
                    <div className="text-slate-900 dark:text-slate-100">
                      {s.ownerId ? (
                        <Link
                          href={`/corrective-actions?owner=${s.ownerId}` as any}
                          className="font-medium hover:underline"
                        >
                          {s.ownerName}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-600 dark:text-slate-400">
                          Unassigned
                        </span>
                      )}
                    </div>
                    {s.ownerEmail ? (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {s.ownerEmail}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{s.total}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{s.open}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{s.inProgress}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs">
                    {s.pendingVerification}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-emerald-700 dark:text-emerald-400">
                    {s.closed}
                  </td>
                  <td
                    className={`px-4 py-2 text-right font-mono text-xs ${s.overdue > 0 ? 'font-medium text-red-700 dark:text-red-400' : ''}`}
                  >
                    {s.overdue}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <CompletionBar value={s.completionRate} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-slate-700 dark:text-slate-300">
                    {s.avgDaysToClose ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        basePath={BASE}
        currentParams={sp}
        total={filtered.length}
        page={page}
        perPage={params.perPage}
      />
    </ListPageLayout>
  )
}

function CompletionBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="inline-flex w-32 items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{pct}%</span>
    </div>
  )
}
