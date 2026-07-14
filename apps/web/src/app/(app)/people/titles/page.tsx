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

export const metadata = { title: 'People — Titles' }
export const dynamic = 'force-dynamic'

const BASE = '/people/titles'
const SORTS = ['name', 'people', 'tasks'] as const

export default async function TitlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
            title="Job titles"
            description="Formal title catalogue with structured Job Description fields, per-title task lists, and per-person sign-offs."
            actions={
              <Link href="/people/titles/new">
                <Button>Add title</Button>
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder="Search by title or scope" />
            <FilterChips
              basePath={BASE}
              currentParams={sp}
              paramKey="status"
              label="Status"
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
      {rows.length === 0 ? (
        <EmptyState
          icon={<IdCard size={32} />}
          title={params.q ? `No titles match "${params.q}"` : 'No titles'}
          description={
            params.q
              ? 'Try a different search.'
              : status === 'archived'
                ? 'Archived titles stay available for audit and can be restored.'
                : 'Define the formal job titles used in Job Description PDFs.'
          }
          action={
            params.q ? undefined : (
              <Link href="/people/titles/new">
                <Button>New title</Button>
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
                  Title
                </SortableTh>
                <TableHead>Scope</TableHead>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  column="people"
                  active={params.sort === 'people'}
                  dir={params.dir}
                >
                  People
                </SortableTh>
                <SortableTh
                  basePath={BASE}
                  currentParams={sp}
                  column="tasks"
                  active={params.sort === 'tasks'}
                  dir={params.dir}
                >
                  Tasks
                </SortableTh>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <Link
                      href={`/people/titles/${t.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                    >
                      {t.name}
                    </Link>
                    {t.deletedAt ? (
                      <Badge variant="secondary" className="ml-2">
                        Archived
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-slate-600 dark:text-slate-300">
                    {t.description ? <span className="line-clamp-2">{t.description}</span> : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      <BadgeCheck size={10} />
                      {t.assignedCount}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      <FileText size={10} />
                      {t.taskCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2 text-xs">
                      {t.deletedAt ? null : (
                        <>
                          <Link
                            href={`/people/titles/${t.id}/tasks`}
                            className="text-teal-700 hover:underline dark:text-teal-400"
                          >
                            Tasks
                          </Link>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                          <Link
                            href={`/people/titles/${t.id}/pdf`}
                            className="text-teal-700 hover:underline dark:text-teal-400"
                            target="_blank"
                          >
                            PDF
                          </Link>
                          <span className="text-slate-300 dark:text-slate-600">·</span>
                        </>
                      )}
                      <Link
                        href={`/people/titles/${t.id}`}
                        className="text-teal-700 hover:underline dark:text-teal-400"
                      >
                        View →
                      </Link>
                    </div>
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
