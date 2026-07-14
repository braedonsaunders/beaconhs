import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
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
  UrlDrawer,
} from '@beaconhs/ui'
import { assertCan, can } from '@beaconhs/tenant'
import {
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypeCriteria,
  inspectionTypes,
  orgUnits,
  tenantUsers,
  users as user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatDate } from '@/lib/datetime'
import { moduleScopeWhere } from '@/lib/visibility'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { RemoteSearchFilter } from '@/components/remote-search-select'
import { ListCard, MobileCardList } from '@/components/list-card'
import { InspectionsSubNav } from '../_sub-nav'
import { parseDateFilter } from '../_datetime'
import { NewInspectionDrawer, type NewInspectionType } from './_new-drawer'
import { startInspection } from './_actions'

export const metadata = { title: 'Inspections' }
export const dynamic = 'force-dynamic'

const SORTS = ['occurred_at', 'reference', 'type', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'closed', label: 'Closed' },
]

export default async function InspectionRecordsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  // Whitelist the status param — an unknown value would throw a Postgres enum
  // error, so unrecognised values fall back to "no filter".
  const statusRaw = pickString(sp.status)
  const statusFilter = STATUS_OPTIONS.some((o) => o.value === statusRaw) ? statusRaw : undefined
  const typeFilter = pickString(sp.type)
  const siteFilter = pickString(sp.site)
  const inspectorFilter = pickString(sp.inspector)
  const signedFilter = pickString(sp.signed) // 'yes' | 'no'
  const dateFromRaw = pickString(sp.dateFrom)
  const dateToRaw = pickString(sp.dateTo)
  const dateFrom = parseDateFilter(dateFromRaw, 'start')
  const dateTo = parseDateFilter(dateToRaw, 'end')
  const drawerKey = pickString(sp.drawer)
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.read.self')
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'inspections.read.self')

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    // Per-user record visibility: read.all → everything, read.site → my sites,
    // else → inspections I performed or submitted.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'inspections',
      ownerCols: [
        inspectionRecords.inspectorTenantUserId,
        inspectionRecords.submittedByTenantUserId,
      ],
      siteCol: inspectionRecords.siteOrgUnitId,
    })
    const filters: SQL<unknown>[] = [isNull(inspectionRecords.deletedAt)]
    if (vis) filters.push(vis)
    if (params.q) {
      const term = `%${params.q}%`
      const c = or(
        ilike(inspectionRecords.reference, term),
        ilike(inspectionTypes.name, term),
        ilike(inspectionRecords.foremanText, term),
      )
      if (c) filters.push(c)
    }
    if (statusFilter) {
      filters.push(
        eq(
          inspectionRecords.status,
          statusFilter as 'draft' | 'in_progress' | 'submitted' | 'closed',
        ),
      )
    }
    if (typeFilter) filters.push(eq(inspectionRecords.typeId, typeFilter))
    if (siteFilter) filters.push(eq(inspectionRecords.siteOrgUnitId, siteFilter))
    if (inspectorFilter) filters.push(eq(inspectionRecords.inspectorTenantUserId, inspectorFilter))
    if (signedFilter === 'yes') filters.push(isNotNull(inspectionRecords.customerSignedAt))
    if (signedFilter === 'no') filters.push(isNull(inspectionRecords.customerSignedAt))
    if (dateFrom) filters.push(gte(inspectionRecords.occurredAt, dateFrom))
    if (dateTo) filters.push(lte(inspectionRecords.occurredAt, dateTo))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(inspectionRecords.reference)
              : desc(inspectionRecords.reference),
          ]
        : params.sort === 'type'
          ? [params.dir === 'asc' ? asc(inspectionTypes.name) : desc(inspectionTypes.name)]
          : params.sort === 'status'
            ? [
                params.dir === 'asc'
                  ? asc(inspectionRecords.status)
                  : desc(inspectionRecords.status),
              ]
            : [
                params.dir === 'asc'
                  ? asc(inspectionRecords.occurredAt)
                  : desc(inspectionRecords.occurredAt),
              ]

    const [tot] = await tx
      .select({ c: count() })
      .from(inspectionRecords)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .where(whereClause)

    const data = await tx
      .select({
        record: inspectionRecords,
        type: inspectionTypes,
        site: orgUnits,
        inspectorName: user.name,
        passCount:
          sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'pass' then 1 else 0 end), 0)`.mapWith(
            Number,
          ),
        failCount:
          sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'fail' then 1 else 0 end), 0)`.mapWith(
            Number,
          ),
        naCount:
          sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'n_a' then 1 else 0 end), 0)`.mapWith(
            Number,
          ),
        totalCount: sql<number>`count(${inspectionRecordCriteria.id})`.mapWith(Number),
      })
      .from(inspectionRecords)
      .innerJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
      .leftJoin(tenantUsers, eq(tenantUsers.id, inspectionRecords.inspectorTenantUserId))
      .leftJoin(user, eq(user.id, tenantUsers.userId))
      .leftJoin(
        inspectionRecordCriteria,
        eq(inspectionRecordCriteria.recordId, inspectionRecords.id),
      )
      .where(whereClause)
      .groupBy(inspectionRecords.id, inspectionTypes.id, orgUnits.id, user.id)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ s: inspectionRecords.status, c: count() })
      .from(inspectionRecords)
      .where(and(vis, isNull(inspectionRecords.deletedAt)))
      .groupBy(inspectionRecords.status)
    const sc: Record<string, number> = {}
    for (const r of ss) sc[r.s] = Number(r.c)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: sc,
    }
  })

  // Type cards for the "Start an inspection" flyout — only loaded while it's open.
  const newTypes: NewInspectionType[] =
    drawerKey === 'new'
      ? await ctx.db(async (tx) => {
          const rows = await tx
            .select({
              id: inspectionTypes.id,
              name: inspectionTypes.name,
              description: inspectionTypes.description,
              requiresCustomerSignature: inspectionTypes.requiresCustomerSignature,
              criteriaCount: count(inspectionTypeCriteria.id),
            })
            .from(inspectionTypes)
            .leftJoin(inspectionTypeCriteria, eq(inspectionTypeCriteria.typeId, inspectionTypes.id))
            .where(and(eq(inspectionTypes.isPublished, true), isNull(inspectionTypes.deletedAt)))
            .groupBy(inspectionTypes.id)
            .orderBy(asc(inspectionTypes.name))
          return rows.map((t) => ({ ...t, criteriaCount: Number(t.criteriaCount ?? 0) }))
        })
      : []

  const sortProps = { basePath: '/inspections/records', currentParams: sp, dir: params.dir }

  return (
    <>
      <ListPageLayout
        header={
          <>
            <PageHeader
              title="Inspections"
              description="Completed inspections with results, signatures, and follow-up actions."
              actions={
                <div className="flex items-center gap-2">
                  {canExport ? (
                    <a href={buildExportHref('/inspections/export.csv', sp)}>
                      <Button variant="outline">Export CSV</Button>
                    </a>
                  ) : null}
                  <Link href="/inspections/records?drawer=new">
                    <Button>New inspection</Button>
                  </Link>
                </div>
              }
            />
            <InspectionsSubNav active="records" />
            <TableToolbar>
              <SearchInput placeholder="Search by reference / type / foreman" />
              <form className="flex items-center gap-1 text-xs">
                {/* Carry every other active filter/sort so applying a date range
                    doesn't wipe the rest of the URL state. */}
                {Object.entries(sp)
                  .filter(
                    ([k, v]) =>
                      !['dateFrom', 'dateTo', 'page'].includes(k) &&
                      typeof v === 'string' &&
                      v !== '',
                  )
                  .map(([k, v]) => (
                    <input key={k} type="hidden" name={k} value={v as string} />
                  ))}
                <label className="flex items-center gap-1 text-slate-500">
                  Occurred from
                  <input
                    type="date"
                    name="dateFrom"
                    defaultValue={dateFromRaw ?? ''}
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </label>
                <label className="flex items-center gap-1 text-slate-500">
                  to
                  <input
                    type="date"
                    name="dateTo"
                    defaultValue={dateToRaw ?? ''}
                    className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                  />
                </label>
                <button
                  type="submit"
                  className="h-8 rounded-md border border-slate-200 px-2 text-xs hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  Apply
                </button>
              </form>
              <FilterChips
                basePath="/inspections/records"
                currentParams={sp}
                paramKey="status"
                label="Status"
                options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
              />
              <RemoteSearchFilter
                lookup="inspection-record-filter-types"
                basePath="/inspections/records"
                currentParams={sp}
                paramKey="type"
                placeholder="All inspection types"
                allLabel="All inspection types"
                searchPlaceholder="Search visible inspection types…"
              />
              <RemoteSearchFilter
                lookup="inspection-record-filter-sites"
                basePath="/inspections/records"
                currentParams={sp}
                paramKey="site"
                placeholder="All sites"
                allLabel="All sites"
                searchPlaceholder="Search visible sites…"
              />
              <RemoteSearchFilter
                lookup="inspection-record-filter-inspectors"
                basePath="/inspections/records"
                currentParams={sp}
                paramKey="inspector"
                placeholder="All inspectors"
                allLabel="All inspectors"
                searchPlaceholder="Search visible inspectors…"
              />
              <FilterChips
                basePath="/inspections/records"
                currentParams={sp}
                paramKey="signed"
                label="Customer signed"
                options={[
                  { value: 'yes', label: 'Signed' },
                  { value: 'no', label: 'Unsigned' },
                ]}
              />
            </TableToolbar>
          </>
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title={
              params.q ||
              statusFilter ||
              typeFilter ||
              siteFilter ||
              inspectorFilter ||
              signedFilter ||
              dateFrom ||
              dateTo
                ? 'No inspection records match these filters'
                : 'No inspection records'
            }
            description="Select an inspection type to start one."
            action={
              <Link href="/inspections/records?drawer=new">
                <Button>New inspection</Button>
              </Link>
            }
          />
        ) : (
          <>
            {/* Phones: tappable cards. */}
            <MobileCardList>
              {rows.map((r) => {
                const total = Number(r.totalCount ?? 0)
                const pass = Number(r.passCount ?? 0)
                const fail = Number(r.failCount ?? 0)
                const na = Number(r.naCount ?? 0)
                const passPct = total > 0 ? Math.round((pass / total) * 100) : null
                return (
                  <ListCard
                    key={r.record.id}
                    href={`/inspections/records/${r.record.id}`}
                    reference={r.record.reference}
                    title={r.type.name}
                    status={
                      <Badge
                        variant={
                          r.record.status === 'closed' || r.record.status === 'submitted'
                            ? 'success'
                            : r.record.status === 'in_progress'
                              ? 'warning'
                              : 'secondary'
                        }
                      >
                        {r.record.status.replace(/_/g, ' ')}
                      </Badge>
                    }
                    person={r.inspectorName}
                    meta={`${formatDate(new Date(r.record.occurredAt), ctx.timezone, ctx.locale)}${
                      r.site?.name ? ` · ${r.site.name}` : ''
                    }`}
                    footer={
                      <>
                        {passPct != null ? (
                          <Badge
                            variant={
                              passPct >= 90 ? 'success' : passPct >= 60 ? 'warning' : 'destructive'
                            }
                            className="text-[10px]"
                          >
                            {passPct}% · {pass}/{fail}/{na}
                          </Badge>
                        ) : null}
                        <Badge
                          variant={r.record.customerSignedAt ? 'success' : 'outline'}
                          className="text-[10px]"
                        >
                          {r.record.customerSignedAt ? 'Signed' : 'Unsigned'}
                        </Badge>
                      </>
                    }
                  />
                )
              })}
            </MobileCardList>

            {/* Tablet/desktop: full sortable table. */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      {...sortProps}
                      column="reference"
                      active={params.sort === 'reference'}
                    >
                      Reference
                    </SortableTh>
                    <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                      Type
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="occurred_at"
                      active={params.sort === 'occurred_at'}
                    >
                      Occurred
                    </SortableTh>
                    <TableHead>Site</TableHead>
                    <TableHead>Inspector</TableHead>
                    <TableHead>Foreman</TableHead>
                    <TableHead>Pass / Fail / N-A</TableHead>
                    <TableHead className="w-20">Signed</TableHead>
                    <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                      Status
                    </SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const total = Number(r.totalCount ?? 0)
                    const pass = Number(r.passCount ?? 0)
                    const fail = Number(r.failCount ?? 0)
                    const na = Number(r.naCount ?? 0)
                    const passPct = total > 0 ? Math.round((pass / total) * 100) : null
                    return (
                      <TableRow key={r.record.id}>
                        <TableCell className="font-mono text-xs">
                          <Link
                            href={`/inspections/records/${r.record.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            {r.record.reference}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/inspections/records/${r.record.id}`}
                            className="hover:underline"
                          >
                            {r.type.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-400">
                          {formatDate(new Date(r.record.occurredAt), ctx.timezone, ctx.locale)}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {r.site?.name ?? '—'}
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          {r.inspectorName ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-600 dark:text-slate-400">
                          {r.record.foremanText ? (
                            <span>{r.record.foremanText}</span>
                          ) : r.record.foremanPersonIds.length > 0 ? (
                            <Badge variant="secondary">
                              {r.record.foremanPersonIds.length} assigned
                            </Badge>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs tabular-nums">
                          {total === 0 ? (
                            <span className="text-slate-400">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span>
                                <span className="text-emerald-700">{pass}</span> /{' '}
                                <span className="text-red-700">{fail}</span> /{' '}
                                <span className="text-slate-500">{na}</span>
                                <span className="ml-1 text-slate-400">({total})</span>
                              </span>
                              {passPct != null ? (
                                <Badge
                                  variant={
                                    passPct >= 90
                                      ? 'success'
                                      : passPct >= 60
                                        ? 'warning'
                                        : 'destructive'
                                  }
                                  className="text-[10px]"
                                >
                                  {passPct}%
                                </Badge>
                              ) : null}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {r.record.customerSignedAt ? (
                            <Badge variant="success" className="text-[10px]">
                              Signed
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              Unsigned
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              r.record.status === 'closed' || r.record.status === 'submitted'
                                ? 'success'
                                : r.record.status === 'in_progress'
                                  ? 'warning'
                                  : 'secondary'
                            }
                          >
                            {r.record.status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <Pagination
              basePath="/inspections/records"
              currentParams={sp}
              total={total}
              page={params.page}
              perPage={params.perPage}
            />
          </>
        )}
      </ListPageLayout>

      <UrlDrawer
        open={drawerKey === 'new'}
        closeHref="/inspections/records"
        title="Start an inspection"
        description="Pick a type to begin — date, site, foreman and notes are captured on the record."
        size="md"
      >
        <NewInspectionDrawer types={newTypes} startAction={startInspection} />
      </UrlDrawer>
    </>
  )
}
