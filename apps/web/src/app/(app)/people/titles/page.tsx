import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { BadgeCheck, FileText, IdCard } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm'
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
import { jobTitleTasks, personTitleAssignments, personTitles } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { parseListParams } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { SortableTh } from '@/components/sortable-th'
import { FilterChips } from '@/components/filter-bar'
import { PeopleSubNav } from '../_components/people-sub-nav'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_06695bd361585b') }
}
export const dynamic = 'force-dynamic'

const BASE = '/people/titles'
const SORTS = ['name', 'people', 'tasks'] as const

export default async function TitlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, { sort: 'name', dir: 'asc', perPage: 25, allowedSorts: SORTS })
  const status =
    sp.status === 'archived' || sp.status === 'all' || sp.status === 'active' ? sp.status : 'active'
  const ctx = await requireModuleManage('people')

  const { rows, total } = await ctx.db(async (tx) => {
    const assigned = tx
      .select({
        titleId: personTitleAssignments.titleId,
        c: count().as('assigned_count'),
      })
      .from(personTitleAssignments)
      .groupBy(personTitleAssignments.titleId)
      .as('assigned_count')

    const tasks = tx
      .select({
        titleId: jobTitleTasks.titleId,
        c: count().as('task_count'),
      })
      .from(jobTitleTasks)
      .where(isNull(jobTitleTasks.deletedAt))
      .groupBy(jobTitleTasks.titleId)
      .as('task_count')

    const filters: SQL<unknown>[] = []
    if (status === 'active') filters.push(isNull(personTitles.deletedAt))
    else if (status === 'archived') filters.push(isNotNull(personTitles.deletedAt))
    if (params.q) {
      const term = `%${params.q}%`
      const cond = or(ilike(personTitles.name, term), ilike(personTitles.description, term))
      if (cond) filters.push(cond)
    }
    const whereClause = and(...filters)

    const dirFn = params.dir === 'asc' ? asc : desc
    const assignedExpr = sql<number>`coalesce(${assigned.c}, 0)`
    const taskExpr = sql<number>`coalesce(${tasks.c}, 0)`
    const orderBy =
      params.sort === 'people'
        ? [dirFn(assignedExpr)]
        : params.sort === 'tasks'
          ? [dirFn(taskExpr)]
          : [dirFn(personTitles.name)]

    const [tot] = await tx.select({ c: count() }).from(personTitles).where(whereClause)
    const page = await tx
      .select({
        id: personTitles.id,
        name: personTitles.name,
        description: personTitles.description,
        deletedAt: personTitles.deletedAt,
        assignedCount: assignedExpr,
        taskCount: taskExpr,
      })
      .from(personTitles)
      .leftJoin(assigned, eq(assigned.titleId, personTitles.id))
      .leftJoin(tasks, eq(tasks.titleId, personTitles.id))
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    return {
      rows: page.map((t) => ({
        ...t,
        assignedCount: Number(t.assignedCount),
        taskCount: Number(t.taskCount),
      })),
      total: Number(tot?.c ?? 0),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PeopleSubNav active="titles" />
          <PageHeader
            title={tGenerated('m_05624b55a0531d')}
            description={tGenerated('m_1e813b0e14cf1f')}
            actions={
              <Link href="/people/titles/new">
                <Button>
                  <GeneratedText id="m_0cfe08e095e151" />
                </Button>
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder={tGenerated('m_16ad092d045e11')} />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              defaultValue="active"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'archived', label: 'Archived' },
              ]}
              allLabel="All"
            />
          </div>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <EmptyState
              icon={<IdCard size={32} />}
              title={tGeneratedValue(
                params.q
                  ? tGenerated('m_148ba986bc851b', { value0: params.q })
                  : tGenerated('m_0c1ecab91ffd6d'),
              )}
              description={tGeneratedValue(
                params.q
                  ? tGenerated('m_11f3c16abb0f07')
                  : status === 'archived'
                    ? tGenerated('m_0fc52916e8f450')
                    : tGenerated('m_1415fce8439d04'),
              )}
              action={
                params.q ? undefined : (
                  <Link href="/people/titles/new">
                    <Button>
                      <GeneratedText id="m_126ad07f6b414e" />
                    </Button>
                  </Link>
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
                      <GeneratedText id="m_0decefd558c355" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_1f10a46fc1db73" />
                    </TableHead>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      column="people"
                      active={params.sort === 'people'}
                      dir={params.dir}
                    >
                      <GeneratedText id="m_1e9ca6c7397706" />
                    </SortableTh>
                    <SortableTh
                      basePath={BASE}
                      currentParams={sp}
                      column="tasks"
                      active={params.sort === 'tasks'}
                      dir={params.dir}
                    >
                      <GeneratedText id="m_188947cc3ae6ae" />
                    </SortableTh>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>
                          <Link
                            href={`/people/titles/${t.id}`}
                            className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                          >
                            <GeneratedValue value={t.name} />
                          </Link>
                          <GeneratedValue
                            value={
                              t.deletedAt ? (
                                <Badge variant="secondary" className="ml-2">
                                  <GeneratedText id="m_12a687134482ba" />
                                </Badge>
                              ) : null
                            }
                          />
                        </TableCell>
                        <TableCell className="text-slate-600 dark:text-slate-300">
                          <GeneratedValue
                            value={
                              t.description ? (
                                <span className="line-clamp-2">
                                  <GeneratedValue value={t.description} />
                                </span>
                              ) : (
                                '—'
                              )
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            <BadgeCheck size={10} />
                            <GeneratedValue value={t.assignedCount} />
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">
                            <FileText size={10} />
                            <GeneratedValue value={t.taskCount} />
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2 text-xs">
                            <GeneratedValue
                              value={
                                t.deletedAt ? null : (
                                  <>
                                    <Link
                                      href={`/people/titles/${t.id}/tasks`}
                                      className="text-teal-700 hover:underline dark:text-teal-400"
                                    >
                                      <GeneratedText id="m_188947cc3ae6ae" />
                                    </Link>
                                    <span className="text-slate-300 dark:text-slate-600">·</span>
                                    <Link
                                      href={`/people/titles/${t.id}/pdf`}
                                      className="text-teal-700 hover:underline dark:text-teal-400"
                                      target="_blank"
                                    >
                                      <GeneratedText id="m_1a2b2ed6729166" />
                                    </Link>
                                    <span className="text-slate-300 dark:text-slate-600">·</span>
                                  </>
                                )
                              }
                            />
                            <Link
                              href={`/people/titles/${t.id}`}
                              className="text-teal-700 hover:underline dark:text-teal-400"
                            >
                              <GeneratedText id="m_1be345fc118df8" />
                            </Link>
                          </div>
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
