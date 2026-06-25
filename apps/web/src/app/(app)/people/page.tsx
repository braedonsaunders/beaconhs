import Link from 'next/link'
import { Users } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { departments, people, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from './_components/people-sub-nav'
import { listPersonDepartmentsForBulk, listPersonGroupsForBulk } from './_actions/bulk'
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
  const departmentFilter = pickString(sp.department) ?? null
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
    if (departmentFilter) baseFilters.push(eq(people.departmentId, departmentFilter))
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

  const [groups, departmentOptions] = await Promise.all([
    listPersonGroupsForBulk(),
    listPersonDepartmentsForBulk(),
  ])
  const activeDepartmentName = departmentFilter
    ? (departmentOptions.find((d) => d.id === departmentFilter)?.name ?? 'Unknown')
    : null

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
          <PageHeader
            title="People"
            description="Your organization's directory of workers, contractors, and supervisors."
            actions={
              <div className="flex items-center gap-2">
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
          <PeopleSubNav active="directory" />
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
            {activeDepartmentName ? (
              <Link
                href={mergeHref('/people', sp, { department: undefined, page: 1 }) as any}
                className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 py-1 pr-2 pl-3 text-xs font-medium text-teal-800 hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-900"
              >
                Department: {activeDepartmentName}
                <span aria-hidden className="text-teal-600 dark:text-teal-400">
                  ✕
                </span>
              </Link>
            ) : null}
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title={params.q ? `No people match "${params.q}"` : 'No people'}
          description="Add people individually, or import them in bulk from a CSV file."
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
            departments={departmentOptions}
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
