import Link from 'next/link'
import { Users } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { departments, people, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from './_components/people-sub-nav'
import { listPersonDivisionsForBulk, listPersonGroupsForBulk } from './_actions/bulk'
import { PeopleRecordsTable, type PeopleTableRow } from './_records-table'

export const metadata = { title: 'People' }

const SORTS = ['name', 'employee_no', 'hire_date', 'department', 'trade', 'status'] as const

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const statusFilter = pickString(sp.status) ?? 'active'
  const ctx = await requireRequestContext()

  const { rows, total, statusCounts, allCount } = await ctx.db(async (tx) => {
    const baseFilters: SQL<unknown>[] = [isNull(people.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(people.employeeNo, term),
      )
      if (cond) baseFilters.push(cond)
    }
    const filters = [...baseFilters]
    if (statusFilter !== 'all') {
      filters.push(eq(people.status, statusFilter as 'active' | 'inactive' | 'terminated'))
    }
    const whereClause = and(...filters)

    const dirFn = params.dir === 'asc' ? asc : desc
    const orderBy =
      params.sort === 'name'
        ? params.dir === 'asc'
          ? [asc(people.lastName), asc(people.firstName)]
          : [desc(people.lastName), desc(people.firstName)]
        : params.sort === 'employee_no'
          ? [dirFn(people.employeeNo)]
          : params.sort === 'hire_date'
            ? [dirFn(people.hireDate)]
            : params.sort === 'department'
              ? [dirFn(departments.name)]
              : params.sort === 'status'
                ? [dirFn(people.status)]
                : [dirFn(trades.name)]

    const [tot] = await tx.select({ c: count() }).from(people).where(whereClause)
    const data = await tx
      .select({
        person: people,
        department: departments,
        trade: trades,
      })
      .from(people)
      .leftJoin(departments, eq(departments.id, people.departmentId))
      .leftJoin(trades, eq(trades.id, people.tradeId))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    // status distribution for the filter chips (over the search-filtered set, ignoring status itself)
    const statusRows = await tx
      .select({ status: people.status, c: count() })
      .from(people)
      .where(and(...baseFilters))
      .groupBy(people.status)
    const statusCounts: Record<string, number> = {}
    let allCount = 0
    for (const r of statusRows) {
      statusCounts[r.status] = Number(r.c)
      allCount += Number(r.c)
    }

    return { rows: data, total: Number(tot?.c ?? 0), statusCounts, allCount }
  })

  const [groups, divisions] = await Promise.all([
    listPersonGroupsForBulk(),
    listPersonDivisionsForBulk(),
  ])

  const tableRows: PeopleTableRow[] = rows.map(({ person, department, trade }) => ({
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    employeeNo: person.employeeNo,
    departmentName: department?.name ?? null,
    tradeName: trade?.name ?? null,
    hireDate: person.hireDate,
    status: person.status,
  }))

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active="directory" />
          <PageHeader
            title="People"
            description="Workers, contractors, and supervisors. Sync from an HRIS via plugins."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/people/org-chart">
                  <Button variant="outline">Org chart</Button>
                </Link>
                <Link href="/people/import">
                  <Button variant="outline">Import people</Button>
                </Link>
                <Link href={buildExportHref('/people/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <Link href="/people/new">
                  <Button>Add person</Button>
                </Link>
              </div>
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder="Search by name or employee #" />
            <FilterChips
              basePath="/people"
              currentParams={{ ...sp, status: statusFilter }}
              paramKey="status"
              label="Status"
              options={[
                { value: 'active', label: 'Active', count: statusCounts.active ?? 0 },
                { value: 'inactive', label: 'Inactive', count: statusCounts.inactive ?? 0 },
                { value: 'all', label: 'All', count: allCount },
              ]}
            />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title={params.q ? `No people match "${params.q}"` : 'No people'}
          description="Add people one at a time, import via CSV from Admin → Import, or enable the NetSuite plugin."
          action={
            <Link href="/people/new">
              <Button>Add person</Button>
            </Link>
          }
        />
      ) : (
        <>
          <PeopleRecordsTable
            rows={tableRows}
            groups={groups}
            divisions={divisions}
            basePath="/people"
            currentParams={sp}
            sort={params.sort}
            dir={params.dir}
          />
          <Pagination
            basePath="/people"
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
