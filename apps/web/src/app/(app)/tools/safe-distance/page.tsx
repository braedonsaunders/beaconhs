import Link from 'next/link'
import { Gauge } from 'lucide-react'
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
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import {
  formatDistance,
  formatVolume,
  SAFE_DISTANCE_METHOD_LABELS,
  type SafeDistanceMethod,
  type SafeDistanceUnit,
} from './_lib'
import { createSafeDistanceRecord } from './_actions'

export const metadata = { title: 'Safe Distance' }

const SORTS = ['reference', 'occurred_at', 'name', 'method'] as const

const METHOD_OPTIONS = (['nasa', 'asme', 'lloyds'] as const).map((v) => ({
  value: v,
  label: SAFE_DISTANCE_METHOD_LABELS[v],
}))

function chosenResult(rec: {
  method: SafeDistanceMethod
  resultNasa: string
  resultAsme: string
  resultLloyds: string
}): string {
  return rec.method === 'nasa'
    ? rec.resultNasa
    : rec.method === 'asme'
      ? rec.resultAsme
      : rec.resultLloyds
}

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
  const methodFilter = pickString(sp.method)

  const ctx = await requireRequestContext()
  const canExport = can(ctx, 'utilities.export')

  const { rows, total, methodCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(safeDistanceRecords.reference, term),
        ilike(safeDistanceRecords.name, term),
        ilike(safeDistanceRecords.description, term),
        ilike(safeDistanceRecords.notes, term),
      )
      if (cond) filters.push(cond)
    }
    if (methodFilter && METHOD_OPTIONS.some((o) => o.value === methodFilter)) {
      filters.push(eq(safeDistanceRecords.method, methodFilter as SafeDistanceMethod))
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'reference'
        ? [
            params.dir === 'asc'
              ? asc(safeDistanceRecords.reference)
              : desc(safeDistanceRecords.reference),
          ]
        : params.sort === 'name'
          ? [params.dir === 'asc' ? asc(safeDistanceRecords.name) : desc(safeDistanceRecords.name)]
          : params.sort === 'method'
            ? [
                params.dir === 'asc'
                  ? asc(safeDistanceRecords.method)
                  : desc(safeDistanceRecords.method),
              ]
            : [
                params.dir === 'asc'
                  ? asc(safeDistanceRecords.occurredAt)
                  : desc(safeDistanceRecords.occurredAt),
              ]

    const [tot] = await tx.select({ c: count() }).from(safeDistanceRecords).where(whereClause)
    const data = await tx
      .select({ rec: safeDistanceRecords, site: orgUnits })
      .from(safeDistanceRecords)
      .leftJoin(orgUnits, eq(orgUnits.id, safeDistanceRecords.siteOrgUnitId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const mc = await tx
      .select({ m: safeDistanceRecords.method, c: count() })
      .from(safeDistanceRecords)
      .groupBy(safeDistanceRecords.method)

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      methodCounts: Object.fromEntries(mc.map((x) => [x.m, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/tools/safe-distance', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Safe Distance"
            description="Pneumatic pressure-test stand-off — NASA-Glenn, ASME PCC-2, and Lloyd's Register."
            back={{ href: '/tools', label: 'All tools' }}
            actions={
              <div className="flex items-center gap-2">
                {canExport ? (
                  <Link href={buildExportHref('/tools/safe-distance/export.csv', sp)}>
                    <Button variant="outline">Export CSV</Button>
                  </Link>
                ) : null}
                {/* Create a blank record and drop straight into the calculator
                    editor — no separate create form. */}
                <form action={createSafeDistanceRecord}>
                  <Button type="submit">New assessment</Button>
                </form>
              </div>
            }
          />
          <TableToolbar>
            <SearchInput placeholder="Search reference, name, notes…" />
            <FilterChips
              basePath="/tools/safe-distance"
              currentParams={sp}
              paramKey="method"
              label="Method"
              options={METHOD_OPTIONS.map((o) => ({ ...o, count: methodCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Gauge size={32} />}
          title={params.q || methodFilter ? 'No assessments match these filters' : 'No assessments'}
          description="Create a pressure-test assessment to calculate the minimum safe stand-off distance for a piping system under pneumatic test."
          action={
            <form action={createSafeDistanceRecord}>
              <Button type="submit">New assessment</Button>
            </form>
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
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                  Name
                </SortableTh>
                <SortableTh
                  {...sortProps}
                  column="occurred_at"
                  active={params.sort === 'occurred_at'}
                >
                  Date
                </SortableTh>
                <SortableTh {...sortProps} column="method" active={params.sort === 'method'}>
                  Method
                </SortableTh>
                <TableHead>Total volume</TableHead>
                <TableHead>Safe distance</TableHead>
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
                  <TableCell>
                    <Link
                      href={`/tools/safe-distance/${rec.id}`}
                      className="font-medium hover:underline"
                    >
                      {rec.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">
                    {rec.occurredAt ? new Date(rec.occurredAt).toISOString().slice(0, 10) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {SAFE_DISTANCE_METHOD_LABELS[rec.method as SafeDistanceMethod]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-700 dark:text-slate-300">
                    {formatVolume(rec.totalVolume, rec.unit as SafeDistanceUnit)}
                  </TableCell>
                  <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                    {formatDistance(chosenResult(rec), rec.unit as SafeDistanceUnit)}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-400">
                    {site?.name ?? '—'}
                  </TableCell>
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
