// "My tasks" — open corrective actions assigned to the current user.
//
// Default scope is "anything that's still on my plate" (open / in_progress /
// pending_verification). Closed + cancelled rows are visible via the status
// filter chips. The overdue computation matches /corrective-actions.

import Link from 'next/link'
import { CheckCircle2, ListChecks } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, inArray, isNull, lte, or, type SQL } from 'drizzle-orm'
import {
  Badge,
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { correctiveActions, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { WorkspaceNoIdentity } from '../_no-identity'

export const metadata = { title: 'My tasks' }
export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'title', 'severity', 'status', 'due_on'] as const

// On the My page we offer one extra synthetic chip — "Open" — that bundles
// every status except closed/cancelled.
const STATUS_OPTIONS = [
  { value: 'all_open', label: 'All open' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'pending_verification', label: 'Pending verification' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
]

// Cast to the enum's literal-union type so drizzle's inArray() signature is happy.
// We can't write the union directly because the enum is declared inside the
// schema package; pinning to `as any[]` would also work but the typed-tuple
// form makes the intent explicit.
type CAStatus = 'open' | 'in_progress' | 'pending_verification' | 'closed' | 'cancelled'
const OPEN_STATUSES: CAStatus[] = ['open', 'in_progress', 'pending_verification']

export default async function MyTasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'due_on',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Default to 'all_open' when no status is explicitly chosen so the page
  // doesn't immediately show closed rows.
  const rawStatus = pickString(sp.status) ?? 'all_open'
  const sevFilter = pickString(sp.severity)
  const overdueOnly = pickString(sp.overdue) === '1'

  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  if (!membershipId) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            title="My tasks"
            description="Corrective actions assigned to you."
            actions={
              <Link href="/corrective-actions">
                <Button variant="outline">All corrective actions</Button>
              </Link>
            }
          />
        }
      >
        <WorkspaceNoIdentity reason="no-membership" noun="tasks" />
      </ListPageLayout>
    )
  }

  const todayStr = new Date().toISOString().slice(0, 10)

  const { rows, total, statusCounts, sevCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [
      eq(correctiveActions.ownerTenantUserId, membershipId),
      isNull(correctiveActions.deletedAt),
    ]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(correctiveActions.reference, term),
        ilike(correctiveActions.title, term),
        ilike(correctiveActions.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (rawStatus === 'all_open') {
      filters.push(inArray(correctiveActions.status, OPEN_STATUSES))
    } else {
      filters.push(eq(correctiveActions.status, rawStatus as CAStatus))
    }
    if (sevFilter) filters.push(eq(correctiveActions.severity, sevFilter as any))
    if (overdueOnly) {
      // Only open statuses can be "overdue" — closed/cancelled rows fall out
      // even if they have a past due date.
      filters.push(inArray(correctiveActions.status, OPEN_STATUSES))
      filters.push(lte(correctiveActions.dueOn, todayStr))
    }
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(correctiveActions.reference)
              : desc(correctiveActions.reference),
          ]
        : params.sort === 'title'
          ? [params.dir === 'asc' ? asc(correctiveActions.title) : desc(correctiveActions.title)]
          : params.sort === 'severity'
            ? [
                params.dir === 'asc'
                  ? asc(correctiveActions.severity)
                  : desc(correctiveActions.severity),
              ]
            : params.sort === 'status'
              ? [
                  params.dir === 'asc'
                    ? asc(correctiveActions.status)
                    : desc(correctiveActions.status),
                ]
              : [
                  params.dir === 'asc'
                    ? asc(correctiveActions.dueOn)
                    : desc(correctiveActions.dueOn),
                ]

    const [tot] = await tx.select({ c: count() }).from(correctiveActions).where(whereClause)
    const data = await tx
      .select({ ca: correctiveActions, site: orgUnits })
      .from(correctiveActions)
      .leftJoin(orgUnits, eq(orgUnits.id, correctiveActions.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    // chip counts: scope to user but drop status/severity filters so
    // each chip shows total under that bucket.
    const baseScope = and(
      eq(correctiveActions.ownerTenantUserId, membershipId),
      isNull(correctiveActions.deletedAt),
    )
    const ss = await tx
      .select({ s: correctiveActions.status, c: count() })
      .from(correctiveActions)
      .where(baseScope)
      .groupBy(correctiveActions.status)
    const sv = await tx
      .select({ s: correctiveActions.severity, c: count() })
      .from(correctiveActions)
      .where(baseScope)
      .groupBy(correctiveActions.severity)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])) as Record<string, number>,
      sevCounts: Object.fromEntries(sv.map((x) => [x.s, Number(x.c)])) as Record<string, number>,
    }
  })

  // Synthesize "all_open" count from the underlying status chip counts so
  // the user can see the bundled total in the chip strip.
  const allOpenCount = OPEN_STATUSES.reduce((sum, k) => sum + (statusCounts[k] ?? 0), 0)
  const statusCountsAugmented: Record<string, number> = {
    ...statusCounts,
    all_open: allOpenCount,
  }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="My tasks"
            description="Corrective actions assigned to you."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/corrective-actions">
                  <Button variant="outline">All corrective actions</Button>
                </Link>
              </div>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search your tasks…" />
            <Link
              href={
                overdueOnly
                  ? `/my/tasks?status=${encodeURIComponent(rawStatus)}`
                  : `/my/tasks?overdue=1&status=all_open`
              }
              className={
                overdueOnly
                  ? 'inline-flex items-center rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700'
                  : 'inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50'
              }
            >
              {overdueOnly ? 'Showing overdue only' : 'Show overdue only'}
            </Link>
            <FilterChips
              basePath="/my/tasks"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({
                ...o,
                count: statusCountsAugmented[o.value],
              }))}
            />
            <FilterChips
              basePath="/my/tasks"
              currentParams={sp}
              paramKey="severity"
              label="Severity"
              options={SEVERITY_OPTIONS.map((o) => ({ ...o, count: sevCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={32} />}
          title={
            params.q || sevFilter || overdueOnly || rawStatus !== 'all_open'
              ? 'No tasks match these filters'
              : 'No open tasks'
          }
          description={
            rawStatus === 'all_open'
              ? 'Tasks assigned to you appear here when created.'
              : 'Adjust the status filter to widen the view.'
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  basePath="/my/tasks"
                  currentParams={sp}
                  dir={params.dir}
                  column="reference"
                  active={params.sort === 'reference'}
                >
                  Ref
                </SortableTh>
                <SortableTh
                  basePath="/my/tasks"
                  currentParams={sp}
                  dir={params.dir}
                  column="title"
                  active={params.sort === 'title'}
                >
                  Title
                </SortableTh>
                <SortableTh
                  basePath="/my/tasks"
                  currentParams={sp}
                  dir={params.dir}
                  column="severity"
                  active={params.sort === 'severity'}
                >
                  Severity
                </SortableTh>
                <SortableTh
                  basePath="/my/tasks"
                  currentParams={sp}
                  dir={params.dir}
                  column="status"
                  active={params.sort === 'status'}
                >
                  Status
                </SortableTh>
                <SortableTh
                  basePath="/my/tasks"
                  currentParams={sp}
                  dir={params.dir}
                  column="due_on"
                  active={params.sort === 'due_on'}
                >
                  Due
                </SortableTh>
                <TableHead>Site</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ ca, site }) => {
                const overdue =
                  ca.dueOn && ca.dueOn < todayStr && !['closed', 'cancelled'].includes(ca.status)
                return (
                  <TableRow key={ca.id}>
                    <TableCell className="font-mono text-xs">
                      <Link href={`/corrective-actions/${ca.id}`} className="hover:underline">
                        {ca.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/corrective-actions/${ca.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {ca.title}
                      </Link>
                      {ca.locked ? (
                        <Badge variant="outline" className="ml-2">
                          locked
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ca.severity === 'critical' || ca.severity === 'high'
                            ? 'destructive'
                            : ca.severity === 'medium'
                              ? 'warning'
                              : 'secondary'
                        }
                      >
                        {ca.severity}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          ca.status === 'closed'
                            ? 'success'
                            : ca.status === 'cancelled'
                              ? 'secondary'
                              : 'warning'
                        }
                      >
                        {ca.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className={overdue ? 'font-medium text-red-700' : ''}>
                        {ca.dueOn ?? '—'}
                        {overdue ? ' (overdue)' : ''}
                      </span>
                    </TableCell>
                    <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/my/tasks"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </ListPageLayout>
  )
}
