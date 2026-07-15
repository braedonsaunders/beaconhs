import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { Users } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import { Button, EmptyState, PageHeader } from '@beaconhs/ui'
import { primaryPersonTitleName } from '@beaconhs/db'
import { departments, people, trades } from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
import { buildExportHref, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { ListPageLayout } from '@/components/page-layout'
import { PeopleSubNav } from './_components/people-sub-nav'
import { listPersonDepartmentsForBulk, listPersonGroupsForBulk } from './_actions/bulk'
import { PeopleRecordsTable, type PeopleTableRow } from './_records-table'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1e9ca6c7397706') }
}

const SORTS = [
  'name',
  'employee_no',
  'title',
  'hire_date',
  'department',
  'trade',
  'status',
] as const
const STATUS_FILTERS = ['active', 'inactive', 'terminated', 'all'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  // people.status is a Postgres enum — validate the param so a hand-edited URL
  // can't reach the query and fail at cast time.
  const rawStatus = pickString(sp.status) ?? 'active'
  const statusFilter: StatusFilter = (STATUS_FILTERS as readonly string[]).includes(rawStatus)
    ? (rawStatus as StatusFilter)
    : 'active'
  const departmentFilter = pickString(sp.department) ?? null
  const ctx = await requireRequestContext()
  const canManage = canManageModule(ctx, 'people')
  const canExport = can(ctx, 'admin.data.export') && can(ctx, 'admin.users.manage')

  const { rows, total, statusCounts, allCount } = await ctx.db(async (tx) => {
    const primaryTitleName = primaryPersonTitleName(people.id, people.tenantId)
    const baseFilters: SQL<unknown>[] = [isNull(people.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(people.employeeNo, term),
        ilike(primaryTitleName, term),
      )
      if (cond) baseFilters.push(cond)
    }
    if (departmentFilter) baseFilters.push(eq(people.departmentId, departmentFilter))
    const filters = [...baseFilters]
    if (statusFilter !== 'all') {
      filters.push(eq(people.status, statusFilter))
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
          : params.sort === 'title'
            ? [dirFn(primaryTitleName)]
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
        primaryTitleName,
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

  const tableRows: PeopleTableRow[] = rows.map(
    ({ person, department, trade, primaryTitleName }) => ({
      id: person.id,
      firstName: person.firstName,
      lastName: person.lastName,
      employeeNo: person.employeeNo,
      primaryTitleName,
      departmentName: department?.name ?? null,
      tradeName: trade?.name ?? null,
      hireDate: person.hireDate,
      status: person.status,
    }),
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_1e9ca6c7397706')}
            description={tGenerated('m_0670df2653c458')}
            actions={
              <div className="flex items-center gap-2">
                <GeneratedValue
                  value={
                    canExport ? (
                      <a href={buildExportHref('/people/export.csv', sp)}>
                        <Button variant="outline">
                          <GeneratedText id="m_14c6440eca1edc" />
                        </Button>
                      </a>
                    ) : null
                  }
                />
                <GeneratedValue
                  value={
                    canManage ? (
                      <Link href="/people/new">
                        <Button>
                          <GeneratedText id="m_12634c941f2fb6" />
                        </Button>
                      </Link>
                    ) : null
                  }
                />
              </div>
            }
          />
          <PeopleSubNav active="directory" />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder={tGenerated('m_1561c55102f953')} />
            <FilterChips
              basePath="/people"
              currentParams={{ ...sp, status: statusFilter }}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={[
                { value: 'active', label: 'Active', count: statusCounts.active ?? 0 },
                { value: 'inactive', label: 'Inactive', count: statusCounts.inactive ?? 0 },
                {
                  value: 'terminated',
                  label: 'Terminated',
                  count: statusCounts.terminated ?? 0,
                },
                { value: 'all', label: 'All', count: allCount },
              ]}
            />
            <GeneratedValue
              value={
                activeDepartmentName ? (
                  <Link
                    href={mergeHref('/people', sp, { department: undefined, page: 1 }) as any}
                    className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 py-1 pr-2 pl-3 text-xs font-medium text-teal-800 hover:bg-teal-100 dark:bg-teal-950/50 dark:text-teal-300 dark:hover:bg-teal-900"
                  >
                    <GeneratedText id="m_1a405689014fdf" />{' '}
                    <GeneratedValue value={activeDepartmentName} />
                    <span aria-hidden className="text-teal-600 dark:text-teal-400">
                      ✕
                    </span>
                  </Link>
                ) : null
              }
            />
          </div>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<Users size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_095a16654a31f4', { value0: params.q })
                  : tGenerated('m_1038b241626b2d'),
              )}
              description={tGenerated('m_0f568be312d6e7')}
              action={
                canManage ? (
                  <Link href="/people/new">
                    <Button>
                      <GeneratedText id="m_12634c941f2fb6" />
                    </Button>
                  </Link>
                ) : null
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
                canManage={canManage}
                canExport={canExport}
              />
              <Pagination
                basePath="/people"
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
