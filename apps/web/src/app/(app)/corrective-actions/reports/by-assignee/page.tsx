import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_14207dd46d2936') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_14207dd46d2936')}
            description={tGenerated('m_052a61649aca3e')}
            back={{ href: '/corrective-actions', label: 'Back to records' }}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">
              <GeneratedValue value={stats.length} /> <GeneratedText id="m_0f7bac1646a471" />
            </Badge>
            <Badge variant="secondary">
              <GeneratedValue value={totalCAs} /> <GeneratedText id="m_1293d7082549a0" />
            </Badge>
            <GeneratedValue
              value={
                totalOverdue > 0 ? (
                  <Badge variant="destructive">
                    <GeneratedValue value={totalOverdue} /> <GeneratedText id="m_06e3b632d95096" />
                  </Badge>
                ) : null
              }
            />
          </div>
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_05581e634cce08')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="attention"
              label={tGenerated('m_0e2e6493b935a9')}
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
      <GeneratedValue
        value={
          pageRows.length === 0 ? (
            <EmptyState
              icon={<Users size={32} />}
              title={tGeneratedValue(
                stats.length === 0
                  ? tGenerated('m_1d961196b20691')
                  : tGenerated('m_1c713ae5b6acf8'),
              )}
              description={tGeneratedValue(
                stats.length === 0
                  ? tGenerated('m_0e17993c267ddb')
                  : tGenerated('m_10e3073047d411'),
              )}
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
                      <GeneratedText id="m_09e0cae12d3f44" />
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
                      <GeneratedText id="m_13829da903be72" />
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
                      <GeneratedText id="m_107ab58c3c38bc" />
                    </SortTh>
                    <th className="px-4 py-2 text-right">
                      <GeneratedText id="m_1a03b06872ffd9" />
                    </th>
                    <th className="px-4 py-2 text-right">
                      <GeneratedText id="m_1deef014073435" />
                    </th>
                    <th className="px-4 py-2 text-right">
                      <GeneratedText id="m_003ea77d773d2d" />
                    </th>
                    <SortTh
                      basePath={BASE}
                      currentParams={sp}
                      sort={params.sort}
                      dir={params.dir}
                      column="overdue"
                      align="right"
                      className="text-right"
                    >
                      <GeneratedText id="m_1e40bdcf2d1ba1" />
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
                      <GeneratedText id="m_19022a9beaaf3b" />
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
                      <GeneratedText id="m_15581e2e7c5544" />
                    </SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  <GeneratedValue
                    value={pageRows.map((s) => (
                      <tr
                        key={s.ownerId ?? 'unassigned'}
                        className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60"
                      >
                        <td className="px-4 py-2">
                          <div className="text-slate-900 dark:text-slate-100">
                            <GeneratedValue
                              value={
                                s.ownerId ? (
                                  <Link
                                    href={`/corrective-actions?owner=${s.ownerId}` as any}
                                    className="font-medium hover:underline"
                                  >
                                    <GeneratedValue value={s.ownerName} />
                                  </Link>
                                ) : (
                                  <span className="font-medium text-slate-600 dark:text-slate-400">
                                    <GeneratedText id="m_10d1d0d92a9aaa" />
                                  </span>
                                )
                              }
                            />
                          </div>
                          <GeneratedValue
                            value={
                              s.ownerEmail ? (
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  <GeneratedValue value={s.ownerEmail} />
                                </div>
                              ) : null
                            }
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          <GeneratedValue value={s.total} />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          <GeneratedValue value={s.open} />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          <GeneratedValue value={s.inProgress} />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs">
                          <GeneratedValue value={s.pendingVerification} />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-emerald-700 dark:text-emerald-400">
                          <GeneratedValue value={s.closed} />
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-mono text-xs ${s.overdue > 0 ? 'font-medium text-red-700 dark:text-red-400' : ''}`}
                        >
                          <GeneratedValue value={s.overdue} />
                        </td>
                        <td className="px-4 py-2 text-right">
                          <CompletionBar value={s.completionRate} />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-xs text-slate-700 dark:text-slate-300">
                          <GeneratedValue value={s.avgDaysToClose ?? '—'} />
                        </td>
                      </tr>
                    ))}
                  />
                </tbody>
              </table>
            </div>
          )
        }
      />
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
      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">
        <GeneratedValue value={pct} />%
      </span>
    </div>
  )
}
