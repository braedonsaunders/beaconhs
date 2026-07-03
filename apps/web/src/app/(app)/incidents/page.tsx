import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { incidentPeople, incidents, orgUnits, people } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { IncidentsSubNav } from './_sub-nav'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { listIncidentClassifications } from './_actions'
import { IncidentsRecordsTable, type IncidentsTableRow } from './_records-table'

export const metadata = { title: 'Incidents' }

const SORTS = ['reference', 'occurred_at', 'severity', 'status', 'type', 'title', 'site'] as const

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
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'incidents.read.self')

  const { rows, total, typeCounts, statusCounts, involved } = await ctx.db(async (tx) => {
    // Per-user record visibility: read.all → everything, read.site → my sites,
    // else → incidents I reported. AND'd into every count + the page query.
    const vis = await moduleScopeWhere(ctx, tx, {
      prefix: 'incidents',
      ownerCols: [incidents.reportedByTenantUserId],
      siteCol: incidents.siteOrgUnitId,
    })
    const filters: SQL<unknown>[] = [isNull(incidents.deletedAt)]
    if (vis) filters.push(vis)
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

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'reference'
        ? [dirFn(incidents.reference)]
        : params.sort === 'severity'
          ? [dirFn(incidents.severity)]
          : params.sort === 'status'
            ? [dirFn(incidents.status)]
            : params.sort === 'type'
              ? [dirFn(incidents.type)]
              : params.sort === 'title'
                ? [dirFn(incidents.title)]
                : params.sort === 'site'
                  ? [dirFn(orgUnits.name)]
                  : [dirFn(incidents.occurredAt)]

    const [tot] = await tx.select({ c: count() }).from(incidents).where(whereClause)
    const data = await tx
      .select({ incident: incidents, site: orgUnits })
      .from(incidents)
      .leftJoin(orgUnits, eq(orgUnits.id, incidents.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const facetWhere = and(isNull(incidents.deletedAt), vis)
    const types = await tx
      .select({ type: incidents.type, c: count() })
      .from(incidents)
      .where(facetWhere)
      .groupBy(incidents.type)
    const statuses = await tx
      .select({ status: incidents.status, c: count() })
      .from(incidents)
      .where(facetWhere)
      .groupBy(incidents.status)

    const pageIds = data.map((d) => d.incident.id)
    const involvedRows =
      pageIds.length > 0
        ? await tx
            .select({
              incidentId: incidentPeople.incidentId,
              firstName: people.firstName,
              lastName: people.lastName,
              nameText: incidentPeople.personNameText,
            })
            .from(incidentPeople)
            .leftJoin(people, eq(people.id, incidentPeople.personId))
            .where(inArray(incidentPeople.incidentId, pageIds))
        : []

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      typeCounts: Object.fromEntries(types.map((t) => [t.type, Number(t.c)])),
      statusCounts: Object.fromEntries(statuses.map((s) => [s.status, Number(s.c)])),
      involved: involvedRows,
    }
  })

  const classifications = await listIncidentClassifications()

  const involvedByIncident = new Map<string, string[]>()
  for (const r of involved) {
    const name = r.firstName ? `${r.lastName}, ${r.firstName}` : r.nameText?.trim() || null
    if (!name) continue
    const list = involvedByIncident.get(r.incidentId) ?? []
    list.push(name)
    involvedByIncident.set(r.incidentId, list)
  }

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
    involved: involvedByIncident.get(incident.id) ?? [],
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
                {canExport ? (
                  <a href={buildExportHref('/incidents/export.csv', sp)}>
                    <Button variant="outline">Export CSV</Button>
                  </a>
                ) : null}
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
              ? 'No matching incidents'
              : 'No incidents reported'
          }
          description="Reported injuries, illnesses, and near-misses appear here."
          action={
            <Link href="/incidents/new">
              <Button>Report an incident</Button>
            </Link>
          }
        />
      ) : (
        <>
          <IncidentsRecordsTable
            rows={tableRows}
            classifications={classifications}
            basePath="/incidents"
            currentParams={sp}
            sort={params.sort}
            dir={params.dir}
          />
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
