import Link from 'next/link'
import { AlertTriangle, Clock } from 'lucide-react'
import { and, asc, eq, inArray, isNull, lt } from 'drizzle-orm'
import { Badge, EmptyState, PageHeader } from '@beaconhs/ui'
import { correctiveActions, orgUnits, tenantUsers, users as user } from '@beaconhs/db/schema'
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

export const metadata = { title: 'Overdue corrective actions' }
export const dynamic = 'force-dynamic'

const BASE = '/corrective-actions/reports/overdue'
const SORTS = ['reference', 'title', 'severity', 'status', 'owner', 'due', 'days', 'site'] as const

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
export default async function OverdueReport({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'days',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const severityParam = pickString(sp.severity)
  const severityFilter = ['low', 'medium', 'high', 'critical'].find(
    (severity) => severity === severityParam,
  )
  const statusParam = pickString(sp.status)
  const statusFilter = ['open', 'in_progress', 'pending_verification'].find(
    (status) => status === statusParam,
  )
  const assignmentParam = pickString(sp.assignment)
  const assignmentFilter =
    assignmentParam === 'assigned' || assignmentParam === 'unassigned' ? assignmentParam : undefined
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
  const flatRows = groups.flatMap((group) =>
    group.rows.map((row) => ({
      ...row,
      ownerTenantUserId: group.ownerTenantUserId,
      ownerName: group.ownerName,
      ownerEmail: group.ownerEmail,
    })),
  )
  const query = params.q?.toLowerCase()
  const filtered = flatRows.filter((row) => {
    if (severityFilter && row.severity !== severityFilter) return false
    if (statusFilter && row.status !== statusFilter) return false
    if (assignmentFilter === 'assigned' && !row.ownerTenantUserId) return false
    if (assignmentFilter === 'unassigned' && row.ownerTenantUserId) return false
    if (!query) return true
    return [
      row.reference,
      row.title,
      row.ownerName,
      row.ownerEmail ?? '',
      row.siteName ?? '',
      row.status,
      row.severity,
    ]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
  const severityRank = { low: 0, medium: 1, high: 2, critical: 3 } as const
  const mult = params.dir === 'asc' ? 1 : -1
  filtered.sort((a, b) => {
    const comparison =
      params.sort === 'reference'
        ? a.reference.localeCompare(b.reference)
        : params.sort === 'title'
          ? a.title.localeCompare(b.title)
          : params.sort === 'severity'
            ? severityRank[a.severity] - severityRank[b.severity]
            : params.sort === 'status'
              ? a.status.localeCompare(b.status)
              : params.sort === 'owner'
                ? a.ownerName.localeCompare(b.ownerName)
                : params.sort === 'due'
                  ? (a.dueOn ?? '').localeCompare(b.dueOn ?? '')
                  : params.sort === 'site'
                    ? (a.siteName ?? '').localeCompare(b.siteName ?? '')
                    : a.daysOverdue - b.daysOverdue
    return comparison * mult || b.daysOverdue - a.daysOverdue
  })
  const pageCount = Math.max(1, Math.ceil(filtered.length / params.perPage))
  const page = Math.min(params.page, pageCount)
  const pageRows = filtered.slice((page - 1) * params.perPage, page * params.perPage)

  return (
    <ListPageLayout
      header={
        <>
          <CorrectiveActionsSubNav active="overdue" />
          <PageHeader
            title="Overdue corrective actions"
            description="Open work past its due date, with the responsible owner visible on every row."
            back={{ href: '/corrective-actions', label: 'Back to records' }}
          />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="destructive">
              <AlertTriangle size={10} className="mr-1" /> {totalCount} overdue
            </Badge>
            <Badge variant="secondary">{groups.length} owners affected</Badge>
          </div>
          <TableToolbar>
            <SearchInput placeholder="Search ref, title, owner, or site…" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="severity"
              label="Severity"
              options={['low', 'medium', 'high', 'critical'].map((severity) => ({
                value: severity,
                label: severity,
                count: flatRows.filter((row) => row.severity === severity).length,
              }))}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={['open', 'in_progress', 'pending_verification'].map((status) => ({
                value: status,
                label: status.replace('_', ' '),
                count: flatRows.filter((row) => row.status === status).length,
              }))}
            />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="assignment"
              label="Owner"
              options={[
                {
                  value: 'assigned',
                  label: 'Assigned',
                  count: flatRows.filter((row) => row.ownerTenantUserId).length,
                },
                {
                  value: 'unassigned',
                  label: 'Unassigned',
                  count: flatRows.filter((row) => !row.ownerTenantUserId).length,
                },
              ]}
            />
          </TableToolbar>
        </>
      }
    >
      {pageRows.length === 0 ? (
        <EmptyState
          icon={<Clock size={32} />}
          title={totalCount === 0 ? 'Nothing overdue' : 'No matching overdue actions'}
          description={
            totalCount === 0
              ? 'Every open corrective action is still inside its due window. Nice.'
              : 'Adjust the search or filters.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs tracking-wide text-slate-500 uppercase dark:border-slate-800 dark:text-slate-400">
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="reference"
                >
                  Ref
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="title"
                >
                  Title
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="severity"
                >
                  Severity
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="status"
                >
                  Status
                </SortTh>
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
                  column="due"
                >
                  Due
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="days"
                >
                  Days overdue
                </SortTh>
                <SortTh
                  basePath={BASE}
                  currentParams={sp}
                  sort={params.sort}
                  dir={params.dir}
                  column="site"
                >
                  Site
                </SortTh>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pageRows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link href={`/corrective-actions/${r.id}` as any} className="hover:underline">
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
                  <td className="px-4 py-2 text-slate-600 dark:text-slate-400">
                    <div>{r.ownerName}</div>
                    {r.ownerEmail ? <div className="text-xs">{r.ownerEmail}</div> : null}
                  </td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">{r.dueOn ?? '—'}</td>
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

function diffDays(dueIso: string, todayIso: string): number {
  const due = Date.parse(dueIso)
  const today = Date.parse(todayIso)
  if (!Number.isFinite(due) || !Number.isFinite(today)) return 0
  return Math.max(0, Math.round((today - due) / 86_400_000))
}
