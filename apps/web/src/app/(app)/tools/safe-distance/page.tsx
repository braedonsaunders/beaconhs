import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Gauge } from 'lucide-react'
import { redirect } from 'next/navigation'
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
import { orgUnits, safeDistanceRecords } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canUseSafeDistance } from '@/lib/safe-distance-access'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_10d9a8a587b168') }
}

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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'occurred_at',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const methodFilter = pickString(sp.method)

  const ctx = await requireRequestContext()
  if (!canUseSafeDistance(ctx)) redirect('/tools')
  const canExport = can(ctx, 'admin.data.export')

  const { rows, total, methodCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [isNull(safeDistanceRecords.deletedAt)]
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
    const whereClause = and(...filters)

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
      .where(isNull(safeDistanceRecords.deletedAt))
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
            title={tGenerated('m_10d9a8a587b168')}
            description={tGenerated('m_0f6ba29274dedf')}
            back={{ href: '/tools', label: 'All tools' }}
            actions={
              <div className="flex items-center gap-2">
                <GeneratedValue
                  value={
                    canExport ? (
                      <Link href={buildExportHref('/tools/safe-distance/export.csv', sp)}>
                        <Button variant="outline">
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </Link>
                    ) : null
                  }
                />
                {/* Create a blank record and drop straight into the calculator
                    editor — no separate create form. */}
                <form action={createSafeDistanceRecord}>
                  <Button type="submit">
                    <GeneratedText id="m_0b765ce4236ed0" />
                  </Button>
                </form>
              </div>
            }
          />
          <TableToolbar>
            <SearchInput placeholder={tGenerated('m_1920732570b204')} />
            <FilterChips
              basePath="/tools/safe-distance"
              currentParams={sp}
              paramKey="method"
              label={tGenerated('m_0984e05d5d435f')}
              options={METHOD_OPTIONS.map((o) => ({ ...o, count: methodCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Gauge size={32} />}
              title={tGeneratedValue(
                params.q || methodFilter
                  ? tGenerated('m_1774cc3000b3a2')
                  : tGenerated('m_0caef616765e46'),
              )}
              description={tGenerated('m_1d956da89d3ecd')}
              action={
                <form action={createSafeDistanceRecord}>
                  <Button type="submit">
                    <GeneratedText id="m_0b765ce4236ed0" />
                  </Button>
                </form>
              }
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      {...sortProps}
                      column="reference"
                      active={params.sort === 'reference'}
                    >
                      <GeneratedText id="m_036b564bb88dfe" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <SortableTh
                      {...sortProps}
                      column="occurred_at"
                      active={params.sort === 'occurred_at'}
                    >
                      <GeneratedText id="m_0285c38761c540" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="method" active={params.sort === 'method'}>
                      <GeneratedText id="m_0984e05d5d435f" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_079362e557e1a4" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0f343b7d03dd86" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_020146dd3d3d5a" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ rec, site }) => (
                      <TableRow key={rec.id}>
                        <TableCell className="font-mono text-xs">
                          <Link href={`/tools/safe-distance/${rec.id}`} className="hover:underline">
                            <GeneratedValue value={rec.reference} />
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/tools/safe-distance/${rec.id}`}
                            className="font-medium hover:underline"
                          >
                            <GeneratedValue value={rec.name} />
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          <GeneratedValue
                            value={
                              rec.occurredAt
                                ? new Date(rec.occurredAt).toISOString().slice(0, 10)
                                : '—'
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            <GeneratedValue
                              value={SAFE_DISTANCE_METHOD_LABELS[rec.method as SafeDistanceMethod]}
                            />
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-700 dark:text-slate-300">
                          <GeneratedValue
                            value={formatVolume(rec.totalVolume, rec.unit as SafeDistanceUnit)}
                          />
                        </TableCell>
                        <TableCell className="font-medium text-slate-900 dark:text-slate-100">
                          <GeneratedValue
                            value={formatDistance(chosenResult(rec), rec.unit as SafeDistanceUnit)}
                          />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-400">
                          <GeneratedValue value={site?.name ?? '—'} />
                        </TableCell>
                      </TableRow>
                    ))}
                  />
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
          )
        }
      />
    </ListPageLayout>
  )
}
