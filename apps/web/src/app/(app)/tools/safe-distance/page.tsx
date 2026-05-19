import Link from 'next/link'
import { Ruler } from 'lucide-react'
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
import { orgUnits, safeDistanceRecords } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { formatDistance, SAFE_DISTANCE_TYPE_LABELS } from './_lib'

export const metadata = { title: 'Safe Distance' }

const SORTS = ['reference', 'occurred_at', 'type', 'complies'] as const

const TYPE_OPTIONS = (
  ['electrical', 'drone', 'overhead_crane', 'vehicle', 'other'] as const
).map((v) => ({ value: v, label: SAFE_DISTANCE_TYPE_LABELS[v] }))

const COMPLIES_OPTIONS = [
  { value: 'yes', label: 'Compliant' },
  { value: 'no', label: 'Non-compliant' },
]

export default async function SafeDistanceListPage({
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
  const compliesFilter = pickString(sp.complies)
  const siteFilter = pickString(sp.site)

  const ctx = await requireRequestContext()

  const { rows, total, typeCounts, compliesCounts, sites } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(safeDistanceRecords.reference, term),
        ilike(safeDistanceRecords.sourceDescription, term),
        ilike(safeDistanceRecords.notes, term),
      )
      if (cond) filters.push(cond)
    }
    if (typeFilter && TYPE_OPTIONS.some((o) => o.value === typeFilter)) {
      filters.push(eq(safeDistanceRecords.type, typeFilter as any))
    }
    if (compliesFilter === 'yes') filters.push(eq(safeDistanceRecords.complies, true))
    if (compliesFilter === 'no') filters.push(eq(safeDistanceRecords.complies, false))
    if (siteFilter) filters.push(eq(safeDistanceRecords.siteOrgUnitId, siteFilter))
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [params.dir === 'asc' ? asc(safeDistanceRecords.reference) : desc(safeDistanceRecords.reference)]
        : params.sort === 'type'
          ? [params.dir === 'asc' ? asc(safeDistanceRecords.type) : desc(safeDistanceRecords.type)]
          : params.sort === 'complies'
            ? [params.dir === 'asc' ? asc(safeDistanceRecords.complies) : desc(safeDistanceRecords.complies)]
            : [params.dir === 'asc' ? asc(safeDistanceRecords.occurredAt) : desc(safeDistanceRecords.occurredAt)]

    const [tot] = await tx
      .select({ c: count() })
      .from(safeDistanceRecords)
      .where(whereClause)
    const data = await tx
      .select({ rec: safeDistanceRecords, site: orgUnits })
      .from(safeDistanceRecords)
      .leftJoin(orgUnits, eq(orgUnits.id, safeDistanceRecords.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const tc = await tx
      .select({ t: safeDistanceRecords.type, c: count() })
      .from(safeDistanceRecords)
      .groupBy(safeDistanceRecords.type)
    const cc = await tx
      .select({ c: safeDistanceRecords.complies, n: count() })
      .from(safeDistanceRecords)
      .groupBy(safeDistanceRecords.complies)
    const siteRows = await tx
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.level, 'site'))
      .orderBy(orgUnits.name)
      .limit(50)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      typeCounts: Object.fromEntries(tc.map((x) => [x.t, Number(x.c)])),
      compliesCounts: {
        yes: Number(cc.find((r) => r.c === true)?.n ?? 0),
        no: Number(cc.find((r) => r.c === false)?.n ?? 0),
      },
      sites: siteRows,
    }
  })

  const sortProps = { basePath: '/tools/safe-distance', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Safe Distance"
            description="Engineering calc + record-keeping for electrical, drone, overhead-crane and vehicle proximity assessments."
            back={{ href: '/tools', label: 'All tools' }}
            actions={
              <div className="flex items-center gap-2">
                <Link href={buildExportHref('/tools/safe-distance/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <Link href="/tools/safe-distance/new">
                  <Button>New assessment</Button>
                </Link>
              </div>
            }
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search reference, description, notes…" />
          </div>
          <div className="space-y-2">
            <FilterChips
              basePath="/tools/safe-distance"
              currentParams={sp}
              paramKey="type"
              label="Type"
              options={TYPE_OPTIONS.map((o) => ({ ...o, count: typeCounts[o.value] }))}
            />
            <FilterChips
              basePath="/tools/safe-distance"
              currentParams={sp}
              paramKey="complies"
              label="Compliance"
              options={COMPLIES_OPTIONS.map((o) => ({
                ...o,
                count: o.value === 'yes' ? compliesCounts.yes : compliesCounts.no,
              }))}
            />
            {sites.length > 0 ? (
              <FilterChips
                basePath="/tools/safe-distance"
                currentParams={sp}
                paramKey="site"
                label="Site"
                options={sites.map((s) => ({ value: s.id, label: s.name }))}
              />
            ) : null}
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Ruler size={32} />}
          title={
            params.q || typeFilter || compliesFilter || siteFilter
              ? 'No assessments match these filters'
              : 'No safe-distance assessments yet'
          }
          description="Create one to record the required vs. actual clearance for an electrical, drone, crane, or vehicle proximity assessment."
          action={
            <Link href="/tools/safe-distance/new">
              <Button>Create the first assessment</Button>
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
                <SortableTh {...sortProps} column="occurred_at" active={params.sort === 'occurred_at'}>
                  Occurred
                </SortableTh>
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                  Type
                </SortableTh>
                <TableHead>Required</TableHead>
                <TableHead>Actual</TableHead>
                <SortableTh {...sortProps} column="complies" active={params.sort === 'complies'}>
                  Compliance
                </SortableTh>
                <TableHead>Site</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ rec, site }) => (
                <TableRow key={rec.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/tools/safe-distance/${rec.id}`} className="hover:underline">
                      {rec.reference}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-700">
                    {rec.occurredAt ? new Date(rec.occurredAt).toISOString().slice(0, 10) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {SAFE_DISTANCE_TYPE_LABELS[rec.type as keyof typeof SAFE_DISTANCE_TYPE_LABELS]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-700">
                    {formatDistance(rec.requiredDistanceM)}
                  </TableCell>
                  <TableCell className="text-slate-700">
                    {formatDistance(rec.actualDistanceM)}
                  </TableCell>
                  <TableCell>
                    {rec.complies ? (
                      <Badge variant="success">Compliant</Badge>
                    ) : (
                      <Badge variant="destructive">Non-compliant</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600">{site?.name ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/tools/safe-distance"
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
