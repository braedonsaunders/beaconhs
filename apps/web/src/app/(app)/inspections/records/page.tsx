import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm'
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
  inspectionRecordCriteria,
  inspectionRecords,
  inspectionTypes,
  orgUnits,
  tenantUsers,
  user,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { InspectionsSubNav } from '../_sub-nav'

export const metadata = { title: 'Inspection Records' }
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
  const statusFilter = pickString(sp.status)
  const typeFilter = pickString(sp.type)
  const siteFilter = pickString(sp.site)
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, types } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const c = or(
        ilike(inspectionRecords.reference, term),
        ilike(inspectionTypes.name, term),
        ilike(inspectionRecords.foremanText, term),
      )
      if (c) filters.push(c)
    }
    if (statusFilter) filters.push(eq(inspectionRecords.status, statusFilter as any))
    if (typeFilter) filters.push(eq(inspectionRecords.typeId, typeFilter))
    if (siteFilter) filters.push(eq(inspectionRecords.siteOrgUnitId, siteFilter))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(inspectionRecords.reference) : desc(inspectionRecords.reference)]
        : params.sort === 'type'
          ? [params.dir === 'asc' ? asc(inspectionTypes.name) : desc(inspectionTypes.name)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(inspectionRecords.status) : desc(inspectionRecords.status)]
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
        passCount: sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'pass' then 1 else 0 end), 0)`.mapWith(Number),
        failCount: sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'fail' then 1 else 0 end), 0)`.mapWith(Number),
        naCount: sql<number>`coalesce(sum(case when ${inspectionRecordCriteria.answer} = 'n_a' then 1 else 0 end), 0)`.mapWith(Number),
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
      .groupBy(inspectionRecords.status)
    const sc: Record<string, number> = {}
    for (const r of ss) sc[r.s] = Number(r.c)

    const tt = await tx
      .select({ id: inspectionTypes.id, name: inspectionTypes.name })
      .from(inspectionTypes)
      .where(eq(inspectionTypes.isPublished, true))
      .orderBy(asc(inspectionTypes.name))

    return { rows: data, total: Number(tot?.c ?? 0), statusCounts: sc, types: tt }
  })

  const sortProps = { basePath: '/inspections/records', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Inspection Records"
            description="Pass / fail / N-A criterion inspections — the legacy detail view, ported. Each record carries per-question photos, severity, and auto-spawned corrective actions."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/inspections/records/new">
                  <Button>New inspection</Button>
                </Link>
              </div>
            }
          />
          <InspectionsSubNav active="records" />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder="Search by reference / type / foreman" />
            {types.length > 0 ? (
              <form className="flex items-center gap-1 text-xs">
                <select
                  name="type"
                  defaultValue={typeFilter ?? ''}
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                >
                  <option value="">All types</option>
                  {types.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                >
                  Filter
                </button>
              </form>
            ) : null}
          </div>
          <FilterChips
            basePath="/inspections/records"
            currentParams={sp}
            paramKey="status"
            label="Status"
            options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
          />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={params.q ? `No records match "${params.q}"` : 'No inspection records yet'}
          description="Pick an inspection type and start one."
          action={
            <Link href="/inspections/records/new">
              <Button>New inspection</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="reference" active={params.sort === 'reference'}>
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
                <TableHead>Pass / Fail / N-A</TableHead>
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
                return (
                  <TableRow key={r.record.id}>
                    <TableCell className="font-mono text-xs">
                      <Link
                        href={`/inspections/records/${r.record.id}`}
                        className="font-medium text-slate-900 hover:underline"
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
                    <TableCell className="text-slate-600">
                      {new Date(r.record.occurredAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-slate-600">{r.site?.name ?? '—'}</TableCell>
                    <TableCell className="text-slate-600">{r.inspectorName ?? '—'}</TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {total === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span>
                          <span className="text-emerald-700">{pass}</span> /{' '}
                          <span className="text-red-700">{fail}</span> /{' '}
                          <span className="text-slate-500">{na}</span>
                          <span className="ml-1 text-slate-400">({total})</span>
                        </span>
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
  )
}
