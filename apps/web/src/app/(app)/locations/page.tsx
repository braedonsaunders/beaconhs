import Link from 'next/link'
import { MapPin } from 'lucide-react'
import {
  and,
  asc,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
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
} from '@beaconhs/ui'
import { customerContacts, orgUnits } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { getTenantHierarchy } from '@/lib/org-hierarchy'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'Locations' }

const SORTS = ['name', 'code'] as const

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status) ?? 'active'
  const ctx = await requireRequestContext()
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'admin.org.manage')
  const hierarchy = await getTenantHierarchy(ctx.tenantId)

  const { rows, total, activeCount, archivedCount } = await ctx.db(async (tx) => {
    const baseFilters: SQL<unknown>[] = [eq(orgUnits.level, 'customer')]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(orgUnits.name, term), ilike(orgUnits.code, term))
      if (cond) baseFilters.push(cond)
    }
    const filters = [...baseFilters]
    if (statusFilter === 'active') filters.push(isNull(orgUnits.deletedAt))
    else if (statusFilter === 'archived') filters.push(isNotNull(orgUnits.deletedAt))
    const whereClause = and(...filters)

    // Active vs archived tallies for the status filter, over the search-filtered
    // set but independent of the status selection itself.
    const [tallies] = await tx
      .select({
        active: sql<string>`count(*) filter (where ${orgUnits.deletedAt} is null)`,
        archived: sql<string>`count(*) filter (where ${orgUnits.deletedAt} is not null)`,
      })
      .from(orgUnits)
      .where(and(...baseFilters))

    const orderBy =
      params.sort === 'code'
        ? [params.dir === 'asc' ? asc(orgUnits.code) : desc(orgUnits.code)]
        : [params.dir === 'asc' ? asc(orgUnits.name) : desc(orgUnits.name)]

    const [tot] = await tx.select({ c: count() }).from(orgUnits).where(whereClause)

    const customers = await tx
      .select()
      .from(orgUnits)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    // Counts for each customer in this page.
    const customerIds = customers.map((c) => c.id)
    const projectCounts = new Map<string, number>()
    const siteCounts = new Map<string, number>()
    const contactCounts = new Map<string, number>()

    if (customerIds.length > 0) {
      // Direct child projects (level=project, parent=this customer)
      const projects = await tx
        .select({ parentId: orgUnits.parentId, c: count() })
        .from(orgUnits)
        .where(and(eq(orgUnits.level, 'project'), inArray(orgUnits.parentId, customerIds)))
        .groupBy(orgUnits.parentId)
      for (const r of projects) {
        if (r.parentId) projectCounts.set(r.parentId, Number(r.c))
      }

      // Sites: direct children OR grandchildren via project.
      // Walk via recursive CTE to count descendants where level='site'.
      // Drizzle's sql tag binds arrays as single params which Postgres
      // can't parse, so we expand the ID list via sql.join.
      const siteRows =
        customerIds.length === 0
          ? []
          : await tx.execute<{ root_id: string; cnt: string }>(sql`
            WITH RECURSIVE descendants AS (
              SELECT id, parent_id, id AS root_id, level
              FROM org_units
              WHERE id IN (${sql.join(
                customerIds.map((id) => sql`${id}`),
                sql`, `,
              )})
              UNION ALL
              SELECT o.id, o.parent_id, d.root_id, o.level
              FROM org_units o
              INNER JOIN descendants d ON o.parent_id = d.id
            )
            SELECT root_id, COUNT(*)::text AS cnt
            FROM descendants
            WHERE level = 'site'
            GROUP BY root_id
          `)
      for (const r of siteRows as unknown as { root_id: string; cnt: string }[]) {
        siteCounts.set(r.root_id, Number(r.cnt))
      }

      // Contacts directly on the customer org_unit
      const contactRows = await tx
        .select({ orgUnitId: customerContacts.orgUnitId, c: count() })
        .from(customerContacts)
        .where(inArray(customerContacts.orgUnitId, customerIds))
        .groupBy(customerContacts.orgUnitId)
      for (const r of contactRows) {
        contactCounts.set(r.orgUnitId, Number(r.c))
      }
    }

    return {
      rows: customers.map((c) => ({
        unit: c,
        projects: projectCounts.get(c.id) ?? 0,
        sites: siteCounts.get(c.id) ?? 0,
        contacts: contactCounts.get(c.id) ?? 0,
      })),
      total: Number(tot?.c ?? 0),
      activeCount: Number(tallies?.active ?? 0),
      archivedCount: Number(tallies?.archived ?? 0),
    }
  })

  const sortProps = { basePath: '/locations', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Locations"
            description="Your locations, plus the projects and sites beneath them. Add on-site contacts (non-employee site managers, client reps) here."
            actions={
              <div className="flex items-center gap-2">
                {canExport ? (
                  <Link href={buildExportHref('/locations/export.csv', sp)}>
                    <Button variant="outline">Export CSV</Button>
                  </Link>
                ) : null}
                <Link href="/locations/new">
                  <Button>Add location</Button>
                </Link>
              </div>
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder="Search by name or code" />
            <FilterChips
              basePath="/locations"
              currentParams={sp}
              paramKey="status"
              label="Status"
              defaultValue="active"
              options={[
                { value: 'active', label: 'Active', count: activeCount },
                { value: 'archived', label: 'Archived', count: archivedCount },
              ]}
            />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<MapPin size={32} />}
          title={
            params.q
              ? `No locations match "${params.q}"`
              : statusFilter === 'archived'
                ? 'No archived locations'
                : 'No locations'
          }
          description={
            statusFilter === 'archived'
              ? 'Archived locations appear here once you archive them from a location page.'
              : 'Add a location to track projects, sites, and on-site contacts.'
          }
          action={
            statusFilter === 'archived' ? null : (
              <Link href="/locations/new">
                <Button>Add location</Button>
              </Link>
            )
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Location
                </SortableTh>
                <SortableTh {...sortProps} column="code" active={params.sort === 'code'}>
                  Code
                </SortableTh>
                <TableHead>Address</TableHead>
                {hierarchy.project ? <TableHead className="text-right">Projects</TableHead> : null}
                {hierarchy.site ? <TableHead className="text-right">Sites</TableHead> : null}
                <TableHead className="text-right">Contacts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ unit, projects, sites, contacts }) => (
                <TableRow key={unit.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/locations/${unit.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {unit.name}
                      </Link>
                      {unit.deletedAt ? <Badge variant="warning">Archived</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-600 dark:text-slate-400">
                    {unit.code ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {formatAddressLine(unit.address) ?? '—'}
                  </TableCell>
                  {hierarchy.project ? (
                    <TableCell className="text-right tabular-nums">{projects}</TableCell>
                  ) : null}
                  {hierarchy.site ? (
                    <TableCell className="text-right tabular-nums">{sites}</TableCell>
                  ) : null}
                  <TableCell className="text-right tabular-nums">{contacts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/locations"
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

function formatAddressLine(
  address: { line1?: string; city?: string; region?: string } | null | undefined,
): string | null {
  if (!address) return null
  const parts = [address.line1, address.city, address.region].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}
