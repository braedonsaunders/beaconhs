import Link from 'next/link'
import { Wrench } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
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
  equipmentWorkOrders,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'

export const metadata = { title: 'Work orders' }

const SORTS = ['reference', 'summary', 'status', 'priority', 'opened_at', 'closed_at'] as const

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting_parts', label: 'Awaiting parts' },
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
  const statusFilter = pickString(sp.status)
  const priorityFilter = pickString(sp.priority)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, priorityCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
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
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(equipmentWorkOrders.reference) : desc(equipmentWorkOrders.reference)]
        : params.sort === 'summary'
          ? [params.dir === 'asc' ? asc(equipmentWorkOrders.summary) : desc(equipmentWorkOrders.summary)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(equipmentWorkOrders.status) : desc(equipmentWorkOrders.status)]
            : params.sort === 'priority'
              ? [params.dir === 'asc' ? asc(equipmentWorkOrders.priority) : desc(equipmentWorkOrders.priority)]
              : params.sort === 'closed_at'
                ? [params.dir === 'asc' ? asc(equipmentWorkOrders.closedAt) : desc(equipmentWorkOrders.closedAt)]
                : [params.dir === 'asc' ? asc(equipmentWorkOrders.openedAt) : desc(equipmentWorkOrders.openedAt)]

    const [tot] = await tx
      .select({ c: count() })
      .from(equipmentWorkOrders)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
      .where(whereClause)

    const data = await tx
      .select({
        wo: equipmentWorkOrders,
        item: equipmentItems,
        assignee: tenantUsers,
        assigneeUser: user,
      })
      .from(equipmentWorkOrders)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentWorkOrders.itemId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, equipmentWorkOrders.assignedToTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ s: equipmentWorkOrders.status, c: count() })
      .from(equipmentWorkOrders)
      .groupBy(equipmentWorkOrders.status)
    const ps = await tx
      .select({ p: equipmentWorkOrders.priority, c: count() })
      .from(equipmentWorkOrders)
      .groupBy(equipmentWorkOrders.priority)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      priorityCounts: Object.fromEntries(ps.map((x) => [x.p, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/equipment/work-orders', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="work-orders" />
          <PageHeader
            title="Work orders"
            description="Track repairs and scheduled service against equipment."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/equipment/work-orders/new">
                  <Button>New work order</Button>
                </Link>
              </div>
            }
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search reference, summary, asset tag…" />
          </div>
          <div className="space-y-2">
            <FilterChips
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="priority"
              label="Priority"
              options={PRIORITY_OPTIONS.map((o) => ({ ...o, count: priorityCounts[o.value] }))}
            />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Wrench size={32} />}
          title={
            params.q || statusFilter || priorityFilter
              ? 'No work orders match these filters'
              : 'No work orders yet'
          }
          description="Open the first work order to start tracking repairs against your equipment."
          action={
            <Link href="/equipment/work-orders/new">
              <Button>Create first work order</Button>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ wo, item, assignee, assigneeUser }) => (
                <TableRow key={wo.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/equipment/work-orders/${wo.id}`} className="hover:underline">
                      {wo.reference}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/equipment/work-orders/${wo.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {wo.summary}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {item ? (
                      <Link href={`/equipment/${item.id}`} className="hover:underline">
                        <span className="font-mono text-xs">{item.assetTag}</span>{' '}
                        <span>{item.name}</span>
                      </Link>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={priorityBadgeVariant(wo.priority)}>{wo.priority}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusBadgeVariant(wo.status)}>
                      {wo.status === 'closed' ? 'completed' : wo.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {assigneeUser?.name ?? assignee?.displayName ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(wo.openedAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
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
