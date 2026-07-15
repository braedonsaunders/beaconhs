import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0cd4ee8439efd8') }
}
export const dynamic = 'force-dynamic'

const BASE = '/people/groups'
const SORTS = ['name', 'members'] as const

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const errorMessage = typeof sp.error === 'string' ? sp.error : null
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
            title={tGenerated('m_1668000fa2a811')}
            description={tGenerated('m_0e4410137a242e')}
            actions={
              <form action={createGroup}>
                <Button type="submit">
                  <GeneratedText id="m_17f5673d4b9449" />
                </Button>
              </form>
            }
          />
          <SearchInput placeholder={tGenerated('m_05fb9a41d3a163')} />
          <GeneratedValue
            value={
              errorMessage ? (
                <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
                  <GeneratedValue value={errorMessage} />
                </p>
              ) : null
            }
          />
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
                  ? tGenerated('m_0cbcddbf88928f', { value0: params.q })
                  : tGenerated('m_15e9b91153fa04'),
              )}
              description={tGeneratedValue(
                params.q ? tGenerated('m_11f3c16abb0f07') : tGenerated('m_158d6dbaed49bc'),
              )}
              action={
                params.q ? undefined : (
                  <form action={createGroup}>
                    <Button type="submit">
                      <GeneratedText id="m_1cffae5082cb21" />
                    </Button>
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
                      <GeneratedText id="m_02b18d5c7f6f2d" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_14d923495cf14c" />
                    </TableHead>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      column="members"
                      active={params.sort === 'members'}
                      dir={params.dir}
                    >
                      <GeneratedText id="m_0ef3898622f868" />
                    </SortableTh>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((g) => (
                      <TableRow key={g.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <GeneratedValue
                              value={
                                g.color ? (
                                  <span
                                    className="inline-block h-3 w-3 rounded-full border border-slate-200 dark:border-slate-700"
                                    style={{ background: g.color }}
                                    aria-hidden
                                  />
                                ) : null
                              }
                            />
                            <Link
                              href={`/people/groups/${g.id}`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={g.name} />
                            </Link>
                          </div>
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          <GeneratedValue
                            value={
                              g.description ? (
                                <span className="line-clamp-2">
                                  <GeneratedValue value={g.description} />
                                </span>
                              ) : (
                                '—'
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            <GeneratedValue value={g.memberCount} />
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Link
                            href={`/people/groups/${g.id}`}
                            className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                          >
                            <GeneratedText id="m_1be345fc118df8" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  />
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
          )
        }
      />
    </ListPageLayout>
  )
}
