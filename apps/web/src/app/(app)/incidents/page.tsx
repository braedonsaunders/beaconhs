import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
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
import { incidents, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'

export const metadata = { title: 'Incidents' }

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

export default async function IncidentsPage({
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

  const { rows, total, typeCounts, statusCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
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
    const whereClause = filters.length > 0 ? and(...filters) : undefined

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

    const types = await tx.select({ type: incidents.type, c: count() }).from(incidents).groupBy(incidents.type)
    const statuses = await tx.select({ status: incidents.status, c: count() }).from(incidents).groupBy(incidents.status)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      typeCounts: Object.fromEntries(types.map((t) => [t.type, Number(t.c)])),
      statusCounts: Object.fromEntries(statuses.map((s) => [s.status, Number(s.c)])),
    }
  })

  const sortProps = { basePath: '/incidents', currentParams: sp, dir: params.dir }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Incidents"
        description="Reports, investigations, and closeouts."
        actions={
          <Link href="/incidents/new">
            <Button>Report incident</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Search reference, title, description…" />
      </div>
      <div className="space-y-2">
        <FilterChips
          basePath="/incidents"
          currentParams={sp}
          paramKey="type"
          label="Type"
          options={TYPE_OPTIONS.map((o) => ({ ...o, count: typeCounts[o.value] }))}
        />
        <FilterChips
          basePath="/incidents"
          currentParams={sp}
          paramKey="status"
          label="Status"
          options={STATUS_OPTIONS.map((o) => ({ ...o, count: statusCounts[o.value] }))}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle size={32} />}
          title={params.q || typeFilter || statusFilter ? 'No incidents match these filters' : 'No incidents reported'}
          description="When a worker reports an injury, illness, or near-miss it shows up here."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="reference" active={params.sort === 'reference'}>Ref</SortableTh>
                <SortableTh {...sortProps} column="occurred_at" active={params.sort === 'occurred_at'}>Occurred</SortableTh>
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>Type</SortableTh>
                <SortableTh {...sortProps} column="severity" active={params.sort === 'severity'}>Severity</SortableTh>
                <SortableTh {...sortProps} column="status" active={params.sort === 'status'}>Status</SortableTh>
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
                  <TableCell className="text-slate-600">{incident.type.replace('_', ' ')}</TableCell>
                  <TableCell><SeverityBadge severity={incident.severity} /></TableCell>
                  <TableCell><StatusBadge status={incident.status} /></TableCell>
                  <TableCell>
                    <Link href={`/incidents/${incident.id}`} className="font-medium text-slate-900 hover:underline">
                      {incident.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/incidents"
            currentParams={sp}
            total={total}
            page={params.page}
            perPage={params.perPage}
          />
        </>
      )}
    </div>
  )
}

export function SeverityBadge({ severity }: { severity: string }) {
  const v =
    severity === 'fatality' || severity === 'lost_time'
      ? 'destructive'
      : severity === 'medical_aid'
        ? 'warning'
        : severity === 'first_aid_only'
          ? 'secondary'
          : 'outline'
  return <Badge variant={v as any}>{severity.replace(/_/g, ' ')}</Badge>
}

export function StatusBadge({ status }: { status: string }) {
  const v =
    status === 'closed'
      ? 'success'
      : status === 'under_investigation' || status === 'pending_review'
        ? 'warning'
        : status === 'reopened'
          ? 'destructive'
          : 'secondary'
  return <Badge variant={v as any}>{status.replace(/_/g, ' ')}</Badge>
}
