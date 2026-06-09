import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { incidents, orgUnits } from '@beaconhs/db/schema'
import { IncidentsSubNav } from './_sub-nav'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { listIncidentClassifications } from './_actions'
import { IncidentsRecordsTable, type IncidentsTableRow } from './_records-table'

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
    const filters: SQL<unknown>[] = [isNull(incidents.deletedAt)]
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

    const types = await tx
      .select({ type: incidents.type, c: count() })
      .from(incidents)
      .groupBy(incidents.type)
    const statuses = await tx
      .select({ status: incidents.status, c: count() })
      .from(incidents)
      .groupBy(incidents.status)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      typeCounts: Object.fromEntries(types.map((t) => [t.type, Number(t.c)])),
      statusCounts: Object.fromEntries(statuses.map((s) => [s.status, Number(s.c)])),
    }
  })

  const classifications = await listIncidentClassifications()

  const tableRows: IncidentsTableRow[] = rows.map(({ incident, site }) => ({
    id: incident.id,
    reference: incident.reference,
    occurredAt: incident.occurredAt.toISOString(),
    type: incident.type,
    severity: incident.severity,
    status: incident.status,
    title: incident.title,
    siteName: site?.name ?? null,
    locked: incident.locked,
  }))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Incidents"
            description="Reports, investigations, and closeouts."
            actions={
              <div className="flex items-center gap-2">
                <Link href={buildExportHref('/incidents/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <Link href="/incidents/new">
                  <Button>Report incident</Button>
                </Link>
              </div>
            }
          />
          <IncidentsSubNav active="records" />

          <TableToolbar>
            <SearchInput placeholder="Search reference, title, description…" />
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
              : 'No incidents reported'
          }
          description="When a worker reports an injury, illness, or near-miss it shows up here."
          action={
            <Link href="/incidents/new">
              <Button>Report an incident</Button>
            </Link>
          }
        />
      ) : (
        <>
          <IncidentsRecordsTable rows={tableRows} classifications={classifications} />
          <Pagination
            basePath="/incidents"
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
