import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Clock } from 'lucide-react'
import { and, asc, count, desc, eq, gte, ilike, lt, or, type SQL } from 'drizzle-orm'
import { can } from '@beaconhs/tenant'
import {
  Badge,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { crews, kioskScans, orgUnits, people } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { ListPageLayout } from '@/components/page-layout'
import { TableToolbar } from '@/components/table-toolbar'
import { parseDatetimeLocal } from '@/lib/datetime'
import { todayISO } from '../journals/_lib'
import { DayPicker } from './day-picker'

export const metadata = { title: 'Kiosk history' }
export const dynamic = 'force-dynamic'

const SORTS = ['scanned_at', 'person', 'kind'] as const

const KIND_OPTIONS = [
  { value: 'in', label: 'Sign-in' },
  { value: 'out', label: 'Sign-out' },
]

/** The day after a yyyy-mm-dd date string (calendar arithmetic, zone-free). */
function nextDayIso(day: string): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export default async function KioskHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'scanned_at',
    dir: 'desc',
    perPage: 50,
    allowedSorts: SORTS,
  })
  const kindFilter = pickString(sp.kind)
  const ctx = await requireRequestContext()
  // Attendance data covers every person in the tenant — restrict to people/user
  // administrators and audit readers rather than any authenticated member.
  if (!can(ctx, 'admin.users.manage') && !can(ctx, 'admin.audit.read')) notFound()

  // Kiosk scans are jobsite-local attendance events: default to TODAY in the
  // viewer's timezone and bucket days as local midnight-to-midnight, not UTC.
  const tz = ctx.timezone
  const requestedDay = pickString(sp.day)
  const dayFilter =
    requestedDay && /^\d{4}-\d{2}-\d{2}$/.test(requestedDay) ? requestedDay : todayISO(tz)
  const dayStart = parseDatetimeLocal(dayFilter, tz) ?? new Date(`${dayFilter}T00:00:00Z`)
  const dayEnd =
    parseDatetimeLocal(nextDayIso(dayFilter), tz) ?? new Date(`${nextDayIso(dayFilter)}T00:00:00Z`)

  const { rows, total, kindCounts } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = [
      gte(kioskScans.scannedAt, dayStart),
      lt(kioskScans.scannedAt, dayEnd),
    ]
    if (kindFilter === 'in' || kindFilter === 'out')
      filters.push(eq(kioskScans.kind, kindFilter as 'in' | 'out'))
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(people.firstName, term), ilike(people.lastName, term))
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'person'
        ? [params.dir === 'asc' ? asc(people.lastName) : desc(people.lastName)]
        : params.sort === 'kind'
          ? [params.dir === 'asc' ? asc(kioskScans.kind) : desc(kioskScans.kind)]
          : [params.dir === 'asc' ? asc(kioskScans.scannedAt) : desc(kioskScans.scannedAt)]

    const [tot] = await tx
      .select({ c: count() })
      .from(kioskScans)
      .innerJoin(people, eq(people.id, kioskScans.personId))
      .where(whereClause)
    const data = await tx
      .select({
        scan: kioskScans,
        person: people,
        site: orgUnits,
        crew: crews,
      })
      .from(kioskScans)
      .innerJoin(people, eq(people.id, kioskScans.personId))
      .leftJoin(orgUnits, eq(orgUnits.id, kioskScans.siteOrgUnitId))
      .leftJoin(crews, eq(crews.id, kioskScans.crewId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const kc = await tx
      .select({ k: kioskScans.kind, c: count() })
      .from(kioskScans)
      .where(and(gte(kioskScans.scannedAt, dayStart), lt(kioskScans.scannedAt, dayEnd)))
      .groupBy(kioskScans.kind)
    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      kindCounts: Object.fromEntries(kc.map((x) => [x.k, Number(x.c)])),
    }
  })

  const sortProps = { basePath: '/kiosk-history', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Kiosk history"
            description="Sign-in / sign-out events captured at jobsite kiosk tablets."
          />
          <TableToolbar>
            <SearchInput placeholder="Search by name" />
            <DayPicker value={dayFilter} />
            <FilterChips
              basePath="/kiosk-history"
              currentParams={sp}
              paramKey="kind"
              label="Kind"
              options={KIND_OPTIONS.map((o) => ({ ...o, count: kindCounts[o.value] }))}
            />
          </TableToolbar>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Clock size={32} />}
          title={`No kiosk scans on ${dayFilter}`}
          description="Kiosk sign-in and sign-out scans appear here."
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  {...sortProps}
                  column="scanned_at"
                  active={params.sort === 'scanned_at'}
                >
                  When
                </SortableTh>
                <SortableTh {...sortProps} column="person" active={params.sort === 'person'}>
                  Person
                </SortableTh>
                <SortableTh {...sortProps} column="kind" active={params.sort === 'kind'}>
                  Kind
                </SortableTh>
                <TableHead>Site</TableHead>
                <TableHead>Crew</TableHead>
                <TableHead>Device</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.scan.id}>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {new Date(row.scan.scannedAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: tz,
                    })}
                  </TableCell>
                  <TableCell>
                    <Link href={`/people/${row.person.id}`} className="font-medium hover:underline">
                      {row.person.lastName}, {row.person.firstName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.scan.kind === 'in' ? (
                      <Badge variant="success">Sign-in</Badge>
                    ) : (
                      <Badge variant="warning">Sign-out</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {row.site?.name ?? '—'}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {row.crew?.name ?? '—'}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-slate-400 dark:text-slate-500">
                    {row.scan.deviceLabel ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath="/kiosk-history"
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
