// "My incidents" — incidents reported by the current user.
//
// Filter is hard-pinned to reportedByTenantUserId = ctx.membership.id. All
// other list-page primitives are reused as-is (SearchInput, FilterChips,
// SortableTh, Pagination) so the UX matches the global /incidents page.

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import {
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
import { incidents, orgUnits } from '@beaconhs/db/schema'
import { SeverityBadge, StatusBadge } from '../../incidents/_badges'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'

export const metadata = { title: 'My incidents' }
export const dynamic = 'force-dynamic'

const SORTS = ['reference', 'occurred_at', 'severity', 'status', 'type'] as const

const TYPE_OPTIONS = [
  { value: 'injury', label: 'Injury' },
  { value: 'illness', label: 'Illness' },
  { value: 'near_miss', label: 'Near-miss' },
  { value: 'property_damage', label: 'Property damage' },
  { value: 'environmental', label: 'Environmental' },
  { value: 'security', label: 'Security' },
]

const STATUS_OPTIONS = [
  { value: 'reported', label: 'Reported' },
  { value: 'under_investigation', label: 'Investigating' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'closed', label: 'Closed' },
  { value: 'reopened', label: 'Reopened' },
]

export default async function MyIncidentsPage({
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
  const typeFilter = pickString(sp.type)
  const statusFilter = pickString(sp.status)

  const ctx = await requireRequestContext()
  const membershipId = ctx.membership?.id ?? null

  // Without a membership (super-admin viewing-as) there's nothing to scope
  // to — render an empty state with a friendly explanation instead of
  // silently showing zero rows.
  if (!membershipId) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            title="My incidents"
            description="Incidents you reported."
            actions={
              <Link href="/incidents">
                <Button variant="outline">All incidents</Button>
              </Link>
            }
          />
        }
      >
        <EmptyState
          icon={<AlertTriangle size={32} />}
          title="No tenant membership"
          description="This view requires you to be a member of a tenant. Switch tenants or sign in as a tenant user to see your reported incidents."
        />
      </ListPageLayout>
    )
  }

  const { rows, total, typeCounts, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [
      eq(incidents.reportedByTenantUserId, membershipId),
      isNull(incidents.deletedAt),
    ]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(incidents.reference, term),
        ilike(incidents.title, term),
        ilike(incidents.description, term),
      )
      if (cond) filters.push(cond)
    }
    if (typeFilter) filters.push(eq(incidents.type, typeFilter as any))
    if (statusFilter) filters.push(eq(incidents.status, statusFilter as any))
    const whereClause = and(...filters)

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(incidents.reference) : desc(incidents.reference)]
        : params.sort === 'severity'
          ? [params.dir === 'asc' ? asc(incidents.severity) : desc(incidents.severity)]
          : params.sort === 'status'
            ? [params.dir === 'asc' ? asc(incidents.status) : desc(incidents.status)]
            : params.sort === 'type'
              ? [params.dir === 'asc' ? asc(incidents.type) : desc(incidents.type)]
              : [params.dir === 'asc' ? asc(incidents.occurredAt) : desc(incidents.occurredAt)]

    const [tot] = await tx.select({ c: count() }).from(incidents).where(whereClause)
    const data = await tx
      .select({ incident: incidents, site: orgUnits })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    // For the chip counts we keep the user-scope filter but drop the type /
    // status filters so the user can see how many of *their* incidents fall
    // into each bucket regardless of what's currently selected.
    const userScopeOnly = and(
      eq(incidents.reportedByTenantUserId, membershipId),
      isNull(incidents.deletedAt),
    )
    const types = await tx
      .select({ type: incidents.type, c: count() })
      .from(incidents)
      .where(userScopeOnly)
      .groupBy(incidents.type)
    const statuses = await tx
      .select({ status: incidents.status, c: count() })
      .from(incidents)
      .where(userScopeOnly)
      .groupBy(incidents.status)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      typeCounts: Object.fromEntries(types.map((t) => [t.type, Number(t.c)])),
      statusCounts: Object.fromEntries(statuses.map((s) => [s.status, Number(s.c)])),
    }
  })

  const sortProps = { basePath: '/my/incidents', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="My incidents"
            description="Incidents you reported."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/incidents">
                  <Button variant="outline">All incidents</Button>
                </Link>
                <Link href="/incidents/new">
                  <Button>Report incident</Button>
                </Link>
              </div>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search your reports…" />
            <FilterChips
              basePath="/my/incidents"
              currentParams={sp}
              paramKey="type"
              label="Type"
              options={TYPE_OPTIONS.map((o) => ({ ...o, count: typeCounts[o.value] }))}
            />
            <FilterChips
              basePath="/my/incidents"
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
          icon={<AlertTriangle size={32} />}
          title={
            params.q || typeFilter || statusFilter
              ? 'No incidents match these filters'
              : 'No reported incidents'
          }
          description="Incidents you report appear here, with progress through investigation and close-out."
          action={
            <Link href="/incidents/new">
              <Button>Report an incident</Button>
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
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                  Type
                </SortableTh>
                <SortableTh {...sortProps} column="severity" active={params.sort === 'severity'}>
                  Severity
                </SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>
                  Status
                </SortableTh>
                <TableHead>Title</TableHead>
                <TableHead>Site</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ incident, site }) => (
                <TableRow key={incident.id}>
                  <TableCell className="font-mono text-xs text-slate-600">
                    <Link href={`/incidents/${incident.id}`} className="hover:underline">
                      {incident.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {new Date(incident.occurredAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-slate-600">
                    {incident.type.replace('_', ' ')}
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={incident.severity} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={incident.status} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/incidents/${incident.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {incident.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/my/incidents"
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
