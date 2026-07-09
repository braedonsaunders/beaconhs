import Link from 'next/link'
import { Wrench } from 'lucide-react'
import { and, asc, count, desc, eq, gte, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm'
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
import {
  equipmentItems,
  equipmentTypes,
  equipmentWorkOrders,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { htmlToSnippet } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { parseListParams, pickString } from '@/lib/list-params'
import { formatDate } from '@/lib/datetime'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Work orders' }

const SORTS = [
  'reference',
  'summary',
  'status',
  'priority',
  'opened_at',
  'closed_at',
  'cost',
  'aging',
] as const

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting_parts', label: 'Awaiting parts' },
  { value: 'repaired', label: 'Repaired' },
  { value: 'verified', label: 'Verified' },
  { value: 'closed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'med', label: 'Medium' },
  { value: 'high', label: 'High' },
]

function statusBadgeVariant(s: string): 'success' | 'warning' | 'secondary' | 'destructive' {
  if (s === 'closed' || s === 'verified' || s === 'repaired') return 'success'
  if (s === 'cancelled') return 'secondary'
  if (s === 'awaiting_parts') return 'destructive'
  return 'warning'
}

function priorityBadgeVariant(p: string): 'destructive' | 'warning' | 'secondary' {
  if (p === 'high') return 'destructive'
  if (p === 'med') return 'warning'
  return 'secondary'
}

export default async function WorkOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'opened_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Default to open work orders; the "All statuses" chip (status=all) clears it.
  const statusRaw = pickString(sp.status) ?? 'open'
  const statusFilter = statusRaw === 'all' ? undefined : statusRaw
  const priorityFilter = pickString(sp.priority)
  const assigneeFilter = pickString(sp.assignee)
  const typeFilter = pickString(sp.type)
  const ageBucketFilter = pickString(sp.age) // 'open7' | 'open30' | 'overdue30'
  const openedFromRaw = pickString(sp.openedFrom)
  const openedToRaw = pickString(sp.openedTo)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, priorityCounts, assigneeOptions, typeOptions } = await ctx.db(
    async (tx) => {
      // Read-tier scope: all → every WO; site → WOs on assets at the caller's
      // sites (plus their own); self → WOs they opened / are assigned / report.
      const scope = await moduleScopeWhere(ctx, tx, {
        prefix: 'equipment',
        ownerCols: [
          equipmentWorkOrders.openedByTenantUserId,
          equipmentWorkOrders.assignedToTenantUserId,
        ],
        siteCol: equipmentItems.currentSiteOrgUnitId,
        personCol: equipmentWorkOrders.reportedByPersonId,
      })
      const filters: SQL<unknown>[] = scope ? [scope] : []
      if (params.q) {
        const term = `%${params.q}%`
        const cond = or(
          ilike(equipmentWorkOrders.reference, term),
          ilike(equipmentWorkOrders.summary, term),
          ilike(equipmentWorkOrders.description, term),
          ilike(equipmentItems.assetTag, term),
          ilike(equipmentItems.name, term),
        )
        if (cond) filters.push(cond)
      }
      if (statusFilter) filters.push(eq(equipmentWorkOrders.status, statusFilter as any))
      if (priorityFilter) filters.push(eq(equipmentWorkOrders.priority, priorityFilter as any))
      if (assigneeFilter)
        filters.push(eq(equipmentWorkOrders.assignedToTenantUserId, assigneeFilter))
      if (typeFilter) filters.push(eq(equipmentItems.typeId, typeFilter))
      if (openedFromRaw) {
        const from = new Date(openedFromRaw)
        if (!Number.isNaN(from.getTime())) filters.push(gte(equipmentWorkOrders.openedAt, from))
      }
      if (openedToRaw) {
        // Inclusive To date: bound strictly below the start of the next day so
        // work orders opened any time on the selected day are included.
        const to = new Date(openedToRaw)
        if (!Number.isNaN(to.getTime())) {
          const nextDay = new Date(to.getTime() + 86_400_000)
          filters.push(lt(equipmentWorkOrders.openedAt, nextDay))
        }
      }
      if (ageBucketFilter === 'open7') {
        filters.push(isNull(equipmentWorkOrders.closedAt))
        filters.push(sql`${equipmentWorkOrders.openedAt} < (now() - interval '7 days')`)
      } else if (ageBucketFilter === 'open30') {
        filters.push(isNull(equipmentWorkOrders.closedAt))
        filters.push(sql`${equipmentWorkOrders.openedAt} < (now() - interval '30 days')`)
      } else if (ageBucketFilter === 'overdue30') {
        filters.push(isNull(equipmentWorkOrders.closedAt))
        filters.push(eq(equipmentWorkOrders.priority, 'high'))
        filters.push(sql`${equipmentWorkOrders.openedAt} < (now() - interval '7 days')`)
      }
      const whereClause = filters.length > 0 ? and(...filters) : undefined

      const orderBy =
        params.sort === 'reference'
          ? [
              params.dir === 'asc'
                ? asc(equipmentWorkOrders.reference)
                : desc(equipmentWorkOrders.reference),
            ]
          : params.sort === 'summary'
            ? [
                params.dir === 'asc'
                  ? asc(equipmentWorkOrders.summary)
                  : desc(equipmentWorkOrders.summary),
              ]
            : params.sort === 'status'
              ? [
                  params.dir === 'asc'
                    ? asc(equipmentWorkOrders.status)
                    : desc(equipmentWorkOrders.status),
                ]
              : params.sort === 'priority'
                ? [
                    params.dir === 'asc'
                      ? asc(equipmentWorkOrders.priority)
                      : desc(equipmentWorkOrders.priority),
                  ]
                : params.sort === 'closed_at'
                  ? [
                      params.dir === 'asc'
                        ? asc(equipmentWorkOrders.closedAt)
                        : desc(equipmentWorkOrders.closedAt),
                    ]
                  : params.sort === 'cost'
                    ? [
                        params.dir === 'asc'
                          ? asc(equipmentWorkOrders.cost)
                          : desc(equipmentWorkOrders.cost),
                      ]
                    : params.sort === 'aging'
                      ? [
                          params.dir === 'asc'
                            ? asc(equipmentWorkOrders.openedAt)
                            : desc(equipmentWorkOrders.openedAt),
                        ]
                      : [
                          params.dir === 'asc'
                            ? asc(equipmentWorkOrders.openedAt)
                            : desc(equipmentWorkOrders.openedAt),
                        ]

      const [tot] = await tx
        .select({ c: count() })
        .from(equipmentWorkOrders)
        .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
        .where(whereClause)

      const data = await tx
        .select({
          wo: equipmentWorkOrders,
          item: equipmentItems,
          type: equipmentTypes,
          assignee: tenantUsers,
          assigneeUser: user,
        })
        .from(equipmentWorkOrders)
        .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
        .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
        .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentWorkOrders.assignedToTenantUserId))
        .leftJoin(user, eq(user.id, tenantUsers.userId))
        .where(whereClause)
        .orderBy(...orderBy)
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage)

      const ss = await tx
        .select({ s: equipmentWorkOrders.status, c: count() })
        .from(equipmentWorkOrders)
        .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
        .where(scope)
        .groupBy(equipmentWorkOrders.status)
      const ps = await tx
        .select({ p: equipmentWorkOrders.priority, c: count() })
        .from(equipmentWorkOrders)
        .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
        .where(scope)
        .groupBy(equipmentWorkOrders.priority)

      const aOpts = await tx
        .select({
          id: tenantUsers.id,
          displayName: tenantUsers.displayName,
          c: count(),
        })
        .from(tenantUsers)
        .innerJoin(
          equipmentWorkOrders,
          eq(equipmentWorkOrders.assignedToTenantUserId, tenantUsers.id),
        )
        .groupBy(tenantUsers.id, tenantUsers.displayName)
        .orderBy(desc(count()))
        .limit(20)

      const tOpts = await tx
        .select({ id: equipmentTypes.id, name: equipmentTypes.name })
        .from(equipmentTypes)
        .orderBy(asc(equipmentTypes.name))
        .limit(50)

      return {
        rows: data,
        total: Number(tot?.c ?? 0),
        statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
        priorityCounts: Object.fromEntries(ps.map((x) => [x.p, Number(x.c)])),
        assigneeOptions: aOpts,
        typeOptions: tOpts,
      }
    },
  )

  const sortProps = { basePath: '/equipment/work-orders', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Work orders"
            description="Track repairs and scheduled service against equipment."
            actions={
              <div className="flex items-center gap-2">
                <Link href={'/equipment/work-orders/new' as any}>
                  <Button>New work order</Button>
                </Link>
              </div>
            }
          />
          <EquipmentSubNav active="work-orders" />
          <TableToolbar>
            <SearchInput placeholder="Search reference, summary, asset tag…" />
            <form className="flex items-center gap-1 text-xs">
              {/* Preserve the other active filters — a bare GET form replaces
                  the whole query string. */}
              {(['q', 'status', 'priority', 'assignee', 'type', 'age', 'sort', 'dir'] as const).map(
                (key) => {
                  const value = pickString(sp[key])
                  return value ? <input key={key} type="hidden" name={key} value={value} /> : null
                },
              )}
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                Opened
                <input
                  type="date"
                  name="openedFrom"
                  defaultValue={openedFromRaw ?? ''}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:[color-scheme:dark]"
                />
              </label>
              <span className="text-slate-400 dark:text-slate-500">to</span>
              <input
                type="date"
                name="openedTo"
                defaultValue={openedToRaw ?? ''}
                className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:[color-scheme:dark]"
              />
              <button
                type="submit"
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Apply
              </button>
            </form>
            <FilterChips
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="status"
              label="Status"
              allLabel="All statuses"
              defaultValue="open"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="priority"
              label="Priority"
              options={PRIORITY_OPTIONS.map((o) => ({ ...o, count: priorityCounts[o.value] }))}
            />
            <FilterChips
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="age"
              label="Aging"
              options={[
                { value: 'open7', label: 'Open 7d+' },
                { value: 'open30', label: 'Open 30d+' },
                { value: 'overdue30', label: 'High prio · 7d+' },
              ]}
            />
            {assigneeOptions.length > 0 ? (
              <FilterChips
                basePath="/equipment/work-orders"
                currentParams={sp}
                paramKey="assignee"
                label="Assignee"
                options={assigneeOptions.slice(0, 12).map((a) => ({
                  value: a.id,
                  label: a.displayName ?? '—',
                  count: Number(a.c ?? 0),
                }))}
              />
            ) : null}
            {typeOptions.length > 0 ? (
              <FilterChips
                basePath="/equipment/work-orders"
                currentParams={sp}
                paramKey="type"
                label="Equipment type"
                options={typeOptions.slice(0, 12).map((t) => ({
                  value: t.id,
                  label: t.name,
                }))}
              />
            ) : null}
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Wrench size={32} />}
          title={
            params.q || statusFilter || priorityFilter
              ? 'No work orders match these filters'
              : 'No work orders'
          }
          description="Open a work order to track repairs against equipment."
          action={
            <Link href={'/equipment/work-orders/new' as any}>
              <Button>New work order</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="reference" active={params.sort === 'reference'}>
                  Ref
                </SortableTh>
                <SortableTh {...sortProps} column="summary" active={params.sort === 'summary'}>
                  Summary
                </SortableTh>
                <TableHead>Equipment</TableHead>
                <TableHead>Type</TableHead>
                <SortableTh {...sortProps} column="priority" active={params.sort === 'priority'}>
                  Priority
                </SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <TableHead>Assignee</TableHead>
                <SortableTh {...sortProps} column="opened_at" active={params.sort === 'opened_at'}>
                  Reported
                </SortableTh>
                <SortableTh {...sortProps} column="closed_at" active={params.sort === 'closed_at'}>
                  Closed
                </SortableTh>
                <SortableTh {...sortProps} column="aging" active={params.sort === 'aging'}>
                  Aging
                </SortableTh>
                <SortableTh {...sortProps} column="cost" active={params.sort === 'cost'}>
                  Cost
                </SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ wo, item, type, assignee, assigneeUser }) => {
                const openedMs = new Date(wo.openedAt).getTime()
                const closedMs = wo.closedAt ? new Date(wo.closedAt).getTime() : Date.now()
                const ageDays = Math.max(0, Math.round((closedMs - openedMs) / 86_400_000))
                const ageVariant: 'success' | 'warning' | 'destructive' | 'secondary' = wo.closedAt
                  ? 'secondary'
                  : ageDays > 30
                    ? 'destructive'
                    : ageDays > 7
                      ? 'warning'
                      : 'success'
                return (
                  <TableRow key={wo.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/equipment/work-orders/${wo.id}` as any}
                        className="hover:underline"
                      >
                        {wo.reference}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/equipment/work-orders/${wo.id}` as any}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {htmlToSnippet(wo.summary)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {item ? (
                        <Link href={`/equipment/${item.id}`} className="hover:underline">
                          <span className="font-mono text-xs">{item.assetTag}</span>{' '}
                          <span>{item.name}</span>
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                      {type?.name ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={priorityBadgeVariant(wo.priority)}>{wo.priority}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusBadgeVariant(wo.status)}>
                        {wo.status === 'closed' ? 'completed' : wo.status.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">
                      {assigneeUser?.name ?? assignee?.displayName ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-300">
                      {formatDate(new Date(wo.openedAt), ctx.timezone)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-300">
                      {wo.closedAt ? (
                        formatDate(new Date(wo.closedAt), ctx.timezone)
                      ) : (
                        <span className="text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <Badge variant={ageVariant}>{ageDays}d</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-300">
                      {wo.cost ? `$${Number(wo.cost).toLocaleString()}` : '—'}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <Pagination
            basePath="/equipment/work-orders"
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
