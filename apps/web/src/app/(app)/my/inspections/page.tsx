// "My inspections" — inspection_records performed by the current user (as the
// inspector). Mirrors the columns from /inspections/records but pinned to
// inspectorTenantUserId = ctx.membership.id.

import Link from 'next/link'
import { ClipboardList } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
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
import { inspectionRecords, inspectionTypes, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { WorkspaceNoIdentity } from '../_no-identity'

export const metadata = { title: 'My inspections' }
export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'occurred_at', 'status'] as const

const STATUS_OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'closed', label: 'Closed' },
]

export default async function MyInspectionsPage({
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

  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  if (!membershipId) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            title="My inspections"
            description="Inspections you carried out."
            actions={
              <Link href="/inspections">
                <Button variant="outline">All inspections</Button>
              </Link>
            }
          />
        }
      >
        <WorkspaceNoIdentity reason="no-membership" noun="inspections" />
      </ListPageLayout>
    )
  }

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [
      eq(inspectionRecords.inspectorTenantUserId, membershipId),
      isNull(inspectionRecords.deletedAt),
    ]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(inspectionRecords.reference, term),
        ilike(inspectionRecords.notes, term),
      )
      if (cond) filters.push(cond)
    }
    if (statusFilter) filters.push(eq(inspectionRecords.status, statusFilter as any))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(inspectionRecords.reference)
              : desc(inspectionRecords.reference),
          ]
        : params.sort === 'status'
          ? [params.dir === 'asc' ? asc(inspectionRecords.status) : desc(inspectionRecords.status)]
          : [
              params.dir === 'asc'
                ? asc(inspectionRecords.occurredAt)
                : desc(inspectionRecords.occurredAt),
            ]

    const [tot] = await tx.select({ c: count() }).from(inspectionRecords).where(whereClause)
    const data = await tx
      .select({ rec: inspectionRecords, type: inspectionTypes, site: orgUnits })
      .from(inspectionRecords)
      .leftJoin(inspectionTypes, eq(inspectionTypes.id, inspectionRecords.typeId))
      .leftJoin(orgUnits, eq(orgUnits.id, inspectionRecords.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const ss = await tx
      .select({ s: inspectionRecords.status, c: count() })
      .from(inspectionRecords)
      .where(
        and(
          eq(inspectionRecords.inspectorTenantUserId, membershipId),
          isNull(inspectionRecords.deletedAt),
        ),
      )
      .groupBy(inspectionRecords.status)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: Object.fromEntries(ss.map((x) => [x.s, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/my/inspections', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="My inspections"
            description="Inspection records you carried out as the inspector."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/inspections/records">
                  <Button variant="outline">All inspections</Button>
                </Link>
                <Link href="/inspections/records?drawer=new">
                  <Button>New inspection</Button>
                </Link>
              </div>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search reference, notes…" />
            <FilterChips
              basePath="/my/inspections"
              currentParams={sp}
              paramKey="status"
              label="Status"
              options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} />}
          title={params.q || statusFilter ? 'No inspections match these filters' : 'No inspections'}
          description="Inspections you carry out appear here."
          action={
            <Link href="/inspections/records?drawer=new">
              <Button>Start an inspection</Button>
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
                <SortableTh
                  {...sortProps}
                  column="occurred_at"
                  active={params.sort === 'occurred_at'}
                >
                  Occurred
                </SortableTh>
                <TableHead>Type</TableHead>
                <TableHead>Site</TableHead>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <TableHead>Customer signed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ rec, type, site }) => (
                <TableRow key={rec.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/inspections/records/${rec.id}`} className="hover:underline">
                      {rec.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(rec.occurredAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell>{type?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        rec.status === 'closed'
                          ? 'success'
                          : rec.status === 'submitted'
                            ? 'default'
                            : rec.status === 'in_progress'
                              ? 'warning'
                              : 'secondary'
                      }
                    >
                      {rec.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {rec.customerSignedAt ? (
                      <Badge variant="success">Signed</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/my/inspections"
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
