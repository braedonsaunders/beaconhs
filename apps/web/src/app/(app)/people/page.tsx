import Link from 'next/link'
import { Users } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, or, type SQL } from 'drizzle-orm'
import {
  Button,
  EmptyState,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import { departments, people, trades } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { buildExportHref, parseListParams } from '@/lib/list-params'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { ListPageLayout } from '@/components/page-layout'

export const metadata = { title: 'People' }

const SORTS = ['name', 'employee_no', 'hire_date', 'department', 'trade'] as const

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const ctx = await requireRequestContext()

  const { rows, total } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(people.employeeNo, term),
      )
      if (cond) filters.push(cond)
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'name'
        ? params.dir === 'asc'
          ? [asc(people.lastName), asc(people.firstName)]
          : [desc(people.lastName), desc(people.firstName)]
        : params.sort === 'employee_no'
          ? [params.dir === 'asc' ? asc(people.employeeNo) : desc(people.employeeNo)]
          : params.sort === 'hire_date'
            ? [params.dir === 'asc' ? asc(people.hireDate) : desc(people.hireDate)]
            : params.sort === 'department'
              ? [params.dir === 'asc' ? asc(departments.name) : desc(departments.name)]
              : [params.dir === 'asc' ? asc(trades.name) : desc(trades.name)]

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

    return { rows: data, total: Number(tot?.c ?? 0) }
  })

  const sortProps = { basePath: '/people', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="People"
            description="Workers, contractors, supervisors. Sync from your HRIS via the plugin framework."
            actions={
              <div className="flex items-center gap-2">
                <Link href={buildExportHref('/people/export.csv', sp)}>
                  <Button variant="outline">Export CSV</Button>
                </Link>
                <Link href="/people/new">
                  <Button>Add person</Button>
                </Link>
              </div>
            }
          />
          <div className="flex items-center gap-3">
            <SearchInput placeholder="Search by name or employee #" />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title={params.q ? `No people match "${params.q}"` : 'No people yet'}
          description="Add people one at a time, import via CSV from Admin → Import, or enable the NetSuite plugin."
          action={
            <Link href="/people/new">
              <Button>Add your first person</Button>
            </Link>
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="name" active={params.sort === 'name'}>Name</SortableTh>
                <SortableTh {...sortProps} column="employee_no" active={params.sort === 'employee_no'}>Employee #</SortableTh>
                <SortableTh {...sortProps} column="department" active={params.sort === 'department'}>Department</SortableTh>
                <SortableTh {...sortProps} column="trade" active={params.sort === 'trade'}>Trade</SortableTh>
                <SortableTh {...sortProps} column="hire_date" active={params.sort === 'hire_date'}>Hire date</SortableTh>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ person, department, trade }) => (
                <TableRow key={person.id}>
                  <TableCell>
                    <Link
                      href={`/people/${person.id}`}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      {person.lastName}, {person.firstName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-slate-600">{person.employeeNo ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{department?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{trade?.name ?? '—'}</TableCell>
                  <TableCell className="text-slate-600">{person.hireDate ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
