import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
  users as user,
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
import { RemoteSearchFilter } from '@/components/remote-search-select'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_093050a92d0364') }
}

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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const renderedAtMs = new Date().getTime()
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

  const { rows, total, statusCounts, priorityCounts } = await ctx.db(async (tx) => {
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
    if (assigneeFilter) filters.push(eq(equipmentWorkOrders.assignedToTenantUserId, assigneeFilter))
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
          <PageHeader
            title={tGenerated('m_093050a92d0364')}
            description={tGenerated('m_025b94aa834f1a')}
            actions={
              <div className="flex items-center gap-2">
                <Link href={'/equipment/work-orders/new' as any}>
                  <Button>
                    <GeneratedText id="m_028792f1fdc70a" />
                  </Button>
                </Link>
              </div>
            }
          />
          <EquipmentSubNav active="work-orders" />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_19d399832e6aa6')} />
            <form className="flex items-center gap-1 text-xs">
              {/* Preserve the other active filters — a bare GET form replaces
                  the whole query string. */}
              <GeneratedValue
                value={(
                  ['q', 'status', 'priority', 'assignee', 'type', 'age', 'sort', 'dir'] as const
                ).map((key) => {
                  const value = pickString(sp[key])
                  return value ? <input key={key} type="hidden" name={key} value={value} /> : null
                })}
              />
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_10fb4212cee361" />
                <input
                  type="date"
                  name="openedFrom"
                  defaultValue={openedFromRaw ?? ''}
                  className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:[color-scheme:dark]"
                />
              </label>
              <span className="text-slate-400 dark:text-slate-500">
                <GeneratedText id="m_02d4f83ff8f11c" />
              </span>
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
                <GeneratedText id="m_01185cdc1c20a5" />
              </button>
            </form>
            <FilterChips
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              allLabel="All statuses"
              defaultValue="open"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
            <FilterChips
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="priority"
              label={tGenerated('m_00f0e2904a371c')}
              options={PRIORITY_OPTIONS.map((o) => ({ ...o, count: priorityCounts[o.value] }))}
            />
            <FilterChips
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="age"
              label={tGenerated('m_13f84c9a65c7c9')}
              options={[
                { value: 'open7', label: 'Open 7d+' },
                { value: 'open30', label: 'Open 30d+' },
                { value: 'overdue30', label: 'High prio · 7d+' },
              ]}
            />
            <RemoteSearchFilter
              lookup="equipment-work-order-filter-assignees"
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="assignee"
              placeholder={tGenerated('m_1243e909f70da5')}
              allLabel="All assignees"
              searchPlaceholder={tGenerated('m_0a2863fa877d51')}
            />
            <RemoteSearchFilter
              lookup="equipment-work-order-filter-types"
              basePath="/equipment/work-orders"
              currentParams={sp}
              paramKey="type"
              placeholder={tGenerated('m_154abecfa0f430')}
              allLabel="All equipment types"
              searchPlaceholder={tGenerated('m_1c552a0e7a59f2')}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Wrench size={32} />}
              title={tGeneratedValue(
                params.q ||
                  statusFilter ||
                  priorityFilter ||
                  assigneeFilter ||
                  typeFilter ||
                  ageBucketFilter ||
                  openedFromRaw ||
                  openedToRaw
                  ? tGenerated('m_09ec3dd217a373')
                  : tGenerated('m_191befd5e4ff41'),
              )}
              description={tGenerated('m_1dcafbb5ff60db')}
              action={
                <Link href={'/equipment/work-orders/new' as any}>
                  <Button>
                    <GeneratedText id="m_028792f1fdc70a" />
                  </Button>
                </Link>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      {...sortProps}
                      column="reference"
                      active={params.sort === 'reference'}
                    >
                      <GeneratedText id="m_036b564bb88dfe" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="summary" active={params.sort === 'summary'}>
                      <GeneratedText id="m_031c356c80b70f" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_17f17df74f7e69" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_074ba2f160c506" />
                    </TableHead>
                    <SortableTh
                      {...sortProps}
                      column="priority"
                      active={params.sort === 'priority'}
                    >
                      <GeneratedText id="m_00f0e2904a371c" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                      <GeneratedText id="m_0b9da892d6faf0" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_03a84b76ec2cd1" />
                    </TableHead>
                    <SortableTh
                      {...sortProps}
                      column="opened_at"
                      active={params.sort === 'opened_at'}
                    >
                      <GeneratedText id="m_14dedf0d22e940" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="closed_at"
                      active={params.sort === 'closed_at'}
                    >
                      <GeneratedText id="m_003ea77d773d2d" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="aging" active={params.sort === 'aging'}>
                      <GeneratedText id="m_13f84c9a65c7c9" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="cost" active={params.sort === 'cost'}>
                      <GeneratedText id="m_139ff0f789d1fa" />
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ wo, item, type, assignee, assigneeUser }) => {
                      const openedMs = new Date(wo.openedAt).getTime()
                      const closedMs = wo.closedAt ? new Date(wo.closedAt).getTime() : renderedAtMs
                      const ageDays = Math.max(0, Math.round((closedMs - openedMs) / 86_400_000))
                      const ageVariant: 'success' | 'warning' | 'destructive' | 'secondary' =
                        wo.closedAt
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
                              <GeneratedValue value={wo.reference} />
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/equipment/work-orders/${wo.id}` as any}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={htmlToSnippet(wo.summary)} />
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={
                                item ? (
                                  <Link href={`/equipment/${item.id}`} className="hover:underline">
                                    <span className="font-mono text-xs">
                                      <GeneratedValue value={item.assetTag} />
                                    </span>
                                    <GeneratedValue value={' '} />
                                    <span>
                                      <GeneratedValue value={item.name} />
                                    </span>
                                  </Link>
                                ) : (
                                  '—'
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-xs text-slate-600 dark:text-slate-300">
                            <GeneratedValue value={type?.name ?? '—'} />
                          </TableCell>
                          <TableCell>
                            <Badge variant={priorityBadgeVariant(wo.priority)}>
                              <GeneratedValue value={wo.priority} />
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusBadgeVariant(wo.status)}>
                              <GeneratedValue
                                value={
                                  wo.status === 'closed' ? (
                                    <GeneratedText id="m_18366de1d27889" />
                                  ) : (
                                    wo.status.replace('_', ' ')
                                  )
                                }
                              />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-300">
                            <GeneratedValue
                              value={assigneeUser?.name ?? assignee?.displayName ?? '—'}
                            />
                          </TableCell>
                          <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-300">
                            <GeneratedValue
                              value={formatDate(new Date(wo.openedAt), ctx.timezone, ctx.locale)}
                            />
                          </TableCell>
                          <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-300">
                            <GeneratedValue
                              value={
                                wo.closedAt ? (
                                  formatDate(new Date(wo.closedAt), ctx.timezone, ctx.locale)
                                ) : (
                                  <span className="text-slate-400 dark:text-slate-500">—</span>
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <Badge variant={ageVariant}>
                              <GeneratedValue value={ageDays} />
                              <GeneratedText id="m_113dda91012a7a" />
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-300">
                            <GeneratedValue
                              value={wo.cost ? `$${Number(wo.cost).toLocaleString()}` : '—'}
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
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
          )
        }
      />
    </ListPageLayout>
  )
}
