import Link from 'next/link'
import { Users } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm'
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
import { personGroupMemberships, personGroups } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { PeopleSubNav } from '../_components/people-sub-nav'
import { createGroup } from '../_actions/groups'

export const metadata = { title: 'People — Groups' }
export const dynamic = 'force-dynamic'

const BASE = '/people/groups'
const SORTS = ['name', 'members'] as const

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const ctx = await requireModuleManage('people')

  const { rows, total } = await ctx.db(async (tx) => {
    const memberCount = tx
      .select({
        groupId: personGroupMemberships.groupId,
        c: count().as('member_count'),
      })
      .from(personGroupMemberships)
      .groupBy(personGroupMemberships.groupId)
      .as('member_count')

    const filters: SQL<unknown>[] = [isNull(personGroups.deletedAt)]
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(personGroups.name, term), ilike(personGroups.description, term))
      if (cond) filters.push(cond)
    }
    const whereClause = and(...filters)

    const dirFn = params.dir === 'asc' ? asc : desc
    const countExpr = sql<number>`coalesce(${memberCount.c}, 0)`
    const orderBy = params.sort === 'members' ? [dirFn(countExpr)] : [dirFn(personGroups.name)]

    const [tot] = await tx.select({ c: count() }).from(personGroups).where(whereClause)
    const page = await tx
      .select({
        id: personGroups.id,
        name: personGroups.name,
        description: personGroups.description,
        color: personGroups.color,
        memberCount: countExpr,
      })
      .from(personGroups)
      .leftJoin(memberCount, eq(memberCount.groupId, personGroups.id))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    return {
      rows: page.map((g) => ({ ...g, memberCount: Number(g.memberCount) })),
      total: Number(tot?.c ?? 0),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active="groups" />
          <PageHeader
            title="Groups"
            description="Tag arbitrary people with cross-cutting labels (JHSC members, fire wardens, first-aid responders, etc.)."
            actions={
              <form action={createGroup}>
                <Button type="submit">Add group</Button>
              </form>
            }
          />
          <SearchInput placeholder="Search by name or description" />
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<Users size={32} />}
          title={params.q ? `No groups match "${params.q}"` : 'No groups'}
          description={
            params.q
              ? 'Try a different search.'
              : 'Flag people for emergency response, committee membership, or other cross-cutting groupings.'
          }
          action={
            params.q ? undefined : (
              <form action={createGroup}>
                <Button type="submit">New group</Button>
              </form>
            )
          }
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  column="name"
                  active={params.sort === 'name'}
                  dir={params.dir}
                >
                  Name
                </SortableTh>
                <TableHead>Description</TableHead>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  column="members"
                  active={params.sort === 'members'}
                  dir={params.dir}
                >
                  Members
                </SortableTh>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((g) => (
                <TableRow key={g.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {g.color ? (
                        <span
                          className="inline-block h-3 w-3 rounded-full border border-slate-200 dark:border-slate-700"
                          style={{ background: g.color }}
                          aria-hidden
                        />
                      ) : null}
                      <Link
                        href={`/people/groups/${g.id}`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {g.name}
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {g.description ? <span className="line-clamp-2">{g.description}</span> : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{g.memberCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/people/groups/${g.id}`}
                      className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                    >
                      View →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            basePath={BASE}
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
