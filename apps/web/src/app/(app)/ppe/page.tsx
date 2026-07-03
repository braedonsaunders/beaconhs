import Link from 'next/link'
import { HardHat } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { people, ppeIssues, ppeItems, ppeTypes } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { PpeSubNav } from '@/components/ppe-sub-nav'
import { createAndIssuePpe, listPeopleForBulkPpe } from './_actions'
import { PpeDrawers } from './_drawers'
import { PpeRecordsTable, type PpeTableRow } from './_records-table'

export const metadata = { title: 'PPE' }

const SORTS = [
  'type',
  'serial',
  'size',
  'status',
  'holder',
  'assigned',
  'last_inspection',
  'next_inspection',
] as const

const STATUS_OPTIONS = [
  { value: 'in_stock', label: 'In stock' },
  { value: 'issued', label: 'Issued' },
  { value: 'returned', label: 'Returned' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'discarded', label: 'Discarded' },
  { value: 'expired', label: 'Expired' },
]

export default async function PpePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'assigned',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Default the register to issued items; an explicit `status=all` (the "All
  // statuses" chip) clears the default so every status shows. Unknown values
  // would throw a Postgres enum error, so they're whitelisted to "no filter".
  const statusRaw = pickString(sp.status) ?? 'issued'
  const statusFilter = STATUS_OPTIONS.some((o) => o.value === statusRaw) ? statusRaw : undefined
  const ctx = await requireRequestContext()
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'ppe.read.all')
  const canIssue = can(ctx, 'ppe.issue') || can(ctx, 'ppe.manage')

  const { rows, total, statusCounts, types } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(ppeItems.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(ppeItems.serialNumber, term), ilike(ppeTypes.name, term))
      if (cond) filters.push(cond)
    }
    if (statusFilter) {
      filters.push(
        eq(
          ppeItems.status,
          statusFilter as 'in_stock' | 'issued' | 'returned' | 'damaged' | 'discarded' | 'expired',
        ),
      )
    }
    const whereClause = and(...filters)

    // "Date assigned" = the most recent issue/replace event for the item (when
    // its current holder received it). Correlated subquery so we can both sort
    // and display it; there is no assigned-date column on ppe_items.
    const assignedAtSql = sql<string | null>`(
      select max(${ppeIssues.occurredAt})
      from ${ppeIssues}
      where ${ppeIssues.itemId} = ${ppeItems.id}
        and ${ppeIssues.action} in ('issue', 'replace')
    )`

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'serial'
        ? [dirFn(ppeItems.serialNumber)]
        : params.sort === 'size'
          ? [dirFn(ppeItems.size)]
          : params.sort === 'status'
            ? [dirFn(ppeItems.status)]
            : params.sort === 'holder'
              ? [dirFn(people.lastName)]
              : params.sort === 'assigned'
                ? // Never-assigned items sink to the bottom in both directions.
                  [
                    params.dir === 'asc'
                      ? sql`${assignedAtSql} asc nulls last`
                      : sql`${assignedAtSql} desc nulls last`,
                  ]
                : params.sort === 'last_inspection'
                  ? // Never-inspected items sink to the bottom in both directions.
                    [
                      params.dir === 'asc'
                        ? sql`${ppeItems.lastInspectionOn} asc nulls last`
                        : sql`${ppeItems.lastInspectionOn} desc nulls last`,
                    ]
                  : params.sort === 'next_inspection'
                    ? [dirFn(ppeItems.nextInspectionDue)]
                    : [dirFn(ppeTypes.name)]

    const [tot] = await tx
      .select({ c: count() })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .where(whereClause)
    const data = await tx
      .select({ item: ppeItems, type: ppeTypes, holder: people, assignedAt: assignedAtSql })
      .from(ppeItems)
      .innerJoin(ppeTypes, eq(ppeTypes.id, ppeItems.typeId))
      .leftJoin(people, eq(people.id, ppeItems.currentHolderPersonId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const ss = await tx
      .select({ s: ppeItems.status, c: count() })
      .from(ppeItems)
      .where(isNull(ppeItems.deletedAt))
      .groupBy(ppeItems.status)
    const typeRows = await tx
      .select({
        id: ppeTypes.id,
        name: ppeTypes.name,
        category: ppeTypes.category,
        sizingScheme: ppeTypes.sizingScheme,
      })
      .from(ppeTypes)
      .orderBy(asc(ppeTypes.name))
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
      types: typeRows,
    }
  })

  // People enumeration is only needed (and only permitted) for issuance flows.
  const holders = canIssue ? await listPeopleForBulkPpe() : []
  const peopleOptions = holders.map((h) => ({
    value: h.id,
    label: h.name,
    hint: h.employeeNo ?? undefined,
  }))
  const issueDrawer = pickString(sp.drawer) === 'issue' ? 'issue' : null

  const tableRows: PpeTableRow[] = rows.map(({ item, type, holder, assignedAt }) => ({
    id: item.id,
    typeName: type.name,
    serialNumber: item.serialNumber,
    size: item.size,
    status: item.status,
    holderName: holder ? `${holder.firstName} ${holder.lastName}` : null,
    assignedOn: assignedAt ? new Date(assignedAt).toISOString().slice(0, 10) : null,
    lastInspectionOn: item.lastInspectionOn,
    nextInspectionDue: item.nextInspectionDue,
  }))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="PPE"
            description="Issue, inspect, and track PPE through its lifecycle."
            actions={
              <div className="flex items-center gap-2">
                {canExport ? (
                  <a href={buildExportHref('/ppe/export.csv', sp)}>
                    <Button variant="outline">Export CSV</Button>
                  </a>
                ) : null}
                <Link href="/ppe?drawer=issue" scroll={false}>
                  <Button>Issue PPE</Button>
                </Link>
              </div>
            }
          />
          <PpeSubNav active="records" />
          <TableToolbar>
            <SearchInput placeholder="Search type or serial #" />
            <FilterChips
              basePath="/ppe"
              currentParams={sp}
              paramKey="status"
              label="Status"
              allLabel="All statuses"
              defaultValue="issued"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<HardHat size={32} />}
          title={params.q || statusFilter ? 'No PPE matches these filters' : 'No PPE registered'}
          description="Track helmets, harnesses, glasses, gloves, and every other inspectable item."
          action={
            <Link href="/ppe?drawer=issue" scroll={false}>
              <Button>Issue PPE</Button>
            </Link>
          }
        />
      ) : (
        <>
          <PpeRecordsTable
            rows={tableRows}
            holders={holders}
            basePath="/ppe"
            currentParams={sp}
            sort={params.sort}
            dir={params.dir}
          />
          <Pagination
            basePath="/ppe"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
      <PpeDrawers
        openDrawer={issueDrawer}
        closeHref="/ppe"
        types={types}
        people={peopleOptions}
        issueAction={createAndIssuePpe}
      />
    </ListPageLayout>
  )
}
