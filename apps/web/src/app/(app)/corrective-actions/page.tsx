import Link from 'next/link'
import { ListChecks } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { correctiveActions, orgUnits, tenantUsers, user } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { CorrectiveActionsSubNav } from '@/components/corrective-actions-sub-nav'
import { listTenantOwners } from './_actions'
import { RecordsTable, type RecordsTableRow } from './_records-table'

export const metadata = { title: 'Corrective Actions' }

const SORTS = [
  'reference',
  'title',
  'severity',
  'status',
  'due_on',
  'assigned_on',
  'created_at',
  'owner',
  'site',
] as const

const STATUS_OPTIONS = [
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

export default async function CorrectiveActionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'created_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Default the list to open actions; an explicit `status=all` (the "All
  // statuses" chip) clears the default so every status shows.
  const statusRaw = pickString(sp.status) ?? 'open'
  const statusFilter = statusRaw === 'all' ? undefined : statusRaw
  const sevFilter = pickString(sp.severity)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, sevCounts } = await ctx.db(async (tx) => {
    // Per-user record visibility: read.all → everything, read.site → my sites,
    // else → corrective actions I own.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'ca',
      ownerCols: [correctiveActions.ownerTenantUserId],
      siteCol: correctiveActions.siteOrgUnitId,
    })
    const filters: SQL<unknown>[] = []
    if (vis) filters.push(vis)
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(correctiveActions.reference, term),
        ilike(correctiveActions.title, term),
        ilike(correctiveActions.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(correctiveActions.status, statusFilter as any))
    if (sevFilter) filters.push(eq(correctiveActions.severity, sevFilter as any))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'reference'
        ? [dirFn(correctiveActions.reference)]
        : params.sort === 'title'
          ? [dirFn(correctiveActions.title)]
          : params.sort === 'severity'
            ? [dirFn(correctiveActions.severity)]
            : params.sort === 'status'
              ? [dirFn(correctiveActions.status)]
              : params.sort === 'due_on'
                ? [dirFn(correctiveActions.dueOn)]
                : params.sort === 'assigned_on'
                  ? [dirFn(correctiveActions.assignedOn)]
                  : params.sort === 'owner'
                    ? [dirFn(sql`coalesce(${user.name}, ${tenantUsers.displayName})`)]
                    : params.sort === 'site'
                      ? [dirFn(orgUnits.name)]
                      : [dirFn(correctiveActions.createdAt)]

    const [tot] = await tx.select({ c: count() }).from(correctiveActions).where(whereClause)
    const data = await tx
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
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ s: correctiveActions.status, c: count() })
      .from(correctiveActions)
      .where(vis)
      .groupBy(correctiveActions.status)
    const sv = await tx
      .select({ s: correctiveActions.severity, c: count() })
      .from(correctiveActions)
      .where(vis)
      .groupBy(correctiveActions.severity)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      sevCounts: Object.fromEntries(sv.map((x) => [x.s, Number(x.c)])),
    }
  })

  const owners = await listTenantOwners()
  const today = new Date().toISOString().slice(0, 10)

  const tableRows: RecordsTableRow[] = rows.map(({ ca, site, owner, ownerAccount }) => ({
    id: ca.id,
    reference: ca.reference,
    title: ca.title,
    severity: ca.severity,
    status: ca.status,
    dueOn: ca.dueOn,
    createdAt: new Date(ca.createdAt).toISOString().slice(0, 10),
    siteName: site?.name ?? null,
    ownerName: ownerAccount?.name ?? owner?.displayName ?? null,
    locked: ca.locked,
  }))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Corrective Actions"
            description="Standalone records, linkable to incidents, inspections, audits, JSHAs."
            actions={
              <div className="flex items-center gap-2">
                <Link
                  href={buildExportHref('/corrective-actions/export.csv', {
                    ...sp,
                    status: statusRaw,
                  })}
                >
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <Link href="/corrective-actions/new">
                  <Button>New action</Button>
                </Link>
              </div>
            }
          />
          <CorrectiveActionsSubNav active="records" />
          <TableToolbar>
            <SearchInput placeholder="Search reference, title, description…" />
            <FilterChips
              basePath="/corrective-actions"
              currentParams={sp}
              paramKey="status"
              label="Status"
              allLabel="All statuses"
              defaultValue="open"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/corrective-actions"
              currentParams={sp}
              paramKey="severity"
              label="Severity"
              options={SEVERITY_OPTIONS.map((o) => ({ ...o, count: sevCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {tableRows.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={32} />}
          title={
            params.q || statusFilter || sevFilter
              ? 'No corrective actions match these filters'
              : 'No corrective actions'
          }
          description="Create one to assign accountability for a fix and track it to verification."
          action={
            <Link href="/corrective-actions/new">
              <Button>New corrective action</Button>
            </Link>
          }
        />
      ) : (
        <>
          <RecordsTable
            rows={tableRows}
            owners={owners}
            today={today}
            basePath="/corrective-actions"
            currentParams={sp}
            sort={params.sort}
            dir={params.dir}
          />
          <Pagination
            basePath="/corrective-actions"
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
