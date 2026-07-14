import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Archive, FileText, IdCard, Printer, Trash2, Users } from 'lucide-react'
import { and, asc, count, eq, ilike, isNull, or } from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DetailHeader,
  Input,
  Label,
  Textarea,
} from '@beaconhs/ui'
import { jobTitleTasks, people, personTitleAssignments, personTitles } from '@beaconhs/db/schema'
import { PageContainer } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { isUuid, parseListParams } from '@/lib/list-params'
import {
  archiveTitle,
  restoreTitle,
  unassignTitleFromPerson,
  updateTitle,
} from '../../_actions/titles'

export const dynamic = 'force-dynamic'

const TABS = ['description', 'people', 'tasks'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Title · ${id.slice(0, 8)}` }
}

export default async function TitleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const active = pickActiveTab(sp, TABS, 'description')
  const errorMessage = typeof sp.error === 'string' ? sp.error : null
  const personParams = parseListParams(
    {
      q: sp.personQ,
      page: sp.personPage,
      perPage: sp.personPerPage,
      sort: 'person',
      dir: 'asc',
    },
    { sort: 'person', dir: 'asc', perPage: 20, allowedSorts: ['person'] as const },
  )

  const ctx = await requireModuleManage('people')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(personTitles).where(eq(personTitles.id, id)).limit(1)
    if (!row) return null
    const assignmentBase = and(eq(personTitleAssignments.titleId, id), isNull(people.deletedAt))
    const personSearch = personParams.q
      ? or(
          ilike(people.firstName, `%${personParams.q}%`),
          ilike(people.lastName, `%${personParams.q}%`),
          ilike(people.employeeNo, `%${personParams.q}%`),
        )
      : undefined
    const assignmentWhere = and(assignmentBase, personSearch)
    const [[taskCountRow], [assignmentCountRow], [filteredAssignmentCountRow]] = await Promise.all([
      tx
        .select({ c: count() })
        .from(jobTitleTasks)
        .where(and(eq(jobTitleTasks.titleId, id), isNull(jobTitleTasks.deletedAt))),
      tx
        .select({ c: count() })
        .from(personTitleAssignments)
        .innerJoin(people, eq(people.id, personTitleAssignments.personId))
        .where(assignmentBase),
      tx
        .select({ c: count() })
        .from(personTitleAssignments)
        .innerJoin(people, eq(people.id, personTitleAssignments.personId))
        .where(assignmentWhere),
    ])
    const assignments =
      active === 'people'
        ? await tx
            .select({
              assignment: personTitleAssignments,
              person: people,
            })
            .from(personTitleAssignments)
            .innerJoin(people, eq(people.id, personTitleAssignments.personId))
            .where(assignmentWhere)
            .orderBy(asc(people.lastName), asc(people.firstName), asc(people.id))
            .limit(personParams.perPage)
            .offset((personParams.page - 1) * personParams.perPage)
        : []
    return {
      row,
      taskCount: Number(taskCountRow?.c ?? 0),
      assignmentCount: Number(assignmentCountRow?.c ?? 0),
      filteredAssignmentCount: Number(filteredAssignmentCountRow?.c ?? 0),
      assignments,
    }
  })
  if (!data) notFound()
  const { row, taskCount, assignmentCount, filteredAssignmentCount, assignments } = data

  const basePath = `/people/titles/${row.id}`

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/people/titles', label: 'Back to titles' }}
          title={row.name}
          subtitle={row.description ?? undefined}
          badge={
            <span className="flex items-center gap-2">
              {row.deletedAt ? <Badge variant="secondary">Archived</Badge> : null}
              <Badge variant="secondary">{assignmentCount} assigned</Badge>
            </span>
          }
          actions={
            <>
              {row.deletedAt ? null : (
                <Link href={`${basePath}/pdf`} target="_blank">
                  <Button variant="outline">
                    <Printer size={14} />
                    Job Description PDF
                  </Button>
                </Link>
              )}
              {row.deletedAt ? (
                <form action={restoreTitle}>
                  <input type="hidden" name="id" value={row.id} />
                  <Button type="submit" variant="outline">
                    Restore
                  </Button>
                </form>
              ) : (
                <form action={archiveTitle}>
                  <input type="hidden" name="id" value={row.id} />
                  <Button
                    type="submit"
                    variant="outline"
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    <Archive size={14} />
                    Archive
                  </Button>
                </form>
              )}
            </>
          }
        />

        {errorMessage ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
            {errorMessage}
          </p>
        ) : null}

        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'description', label: 'Job Description' },
            { key: 'people', label: 'Assigned people', count: assignmentCount },
            { key: 'tasks', label: 'Tasks', count: taskCount },
          ]}
        />

        {active === 'description' ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IdCard size={16} />
                Job Description
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateTitle} className="space-y-4">
                <input type="hidden" name="id" value={row.id} />
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    name="name"
                    defaultValue={row.name}
                    required
                    disabled={Boolean(row.deletedAt)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Scope</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={3}
                    defaultValue={row.description ?? ''}
                    disabled={Boolean(row.deletedAt)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="responsibilities">Responsibilities</Label>
                  <Textarea
                    id="responsibilities"
                    name="responsibilities"
                    rows={6}
                    defaultValue={row.responsibilities ?? ''}
                    disabled={Boolean(row.deletedAt)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="education">Education</Label>
                    <Textarea
                      id="education"
                      name="education"
                      rows={4}
                      defaultValue={row.education ?? ''}
                      disabled={Boolean(row.deletedAt)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="experience">Experience</Label>
                    <Textarea
                      id="experience"
                      name="experience"
                      rows={4}
                      defaultValue={row.experience ?? ''}
                      disabled={Boolean(row.deletedAt)}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="submit" disabled={Boolean(row.deletedAt)}>
                    Save Job Description
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {active === 'people' ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users size={16} />
                People assigned this title
                <Badge variant="secondary">{assignments.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchInput
                placeholder="Search assigned people…"
                paramKey="personQ"
                pageParamKey="personPage"
              />
              {assignments.length === 0 ? (
                <p className="text-sm text-slate-500">
                  {personParams.q
                    ? 'No assigned people match your search.'
                    : "No one assigned. Assign this title from a person's Overview tab."}
                </p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {assignments.map(({ assignment, person }) => (
                    <li
                      key={assignment.id}
                      className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2"
                    >
                      <Link href={`/people/${person.id}`} className="flex-1 hover:underline">
                        <span className="block text-sm font-medium">
                          {person.lastName}, {person.firstName}
                        </span>
                        {person.employeeNo ? (
                          <span className="text-xs text-slate-500">{person.employeeNo}</span>
                        ) : null}
                      </Link>
                      {assignment.isPrimary ? <Badge variant="success">Primary</Badge> : null}
                      <form action={unassignTitleFromPerson}>
                        <input type="hidden" name="titleId" value={row.id} />
                        <input type="hidden" name="personId" value={person.id} />
                        <Button
                          type="submit"
                          size="sm"
                          variant="ghost"
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 size={12} />
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              <Pagination
                basePath={basePath}
                currentParams={sp}
                total={filteredAssignmentCount}
                page={personParams.page}
                perPage={personParams.perPage}
                pageParamKey="personPage"
              />
            </CardContent>
          </Card>
        ) : null}

        {active === 'tasks' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText size={16} />
                Job-description tasks
                <Badge variant="secondary">{taskCount}</Badge>
              </CardTitle>
              {row.deletedAt ? (
                <Button size="sm" variant="outline" disabled>
                  Restore title to manage tasks
                </Button>
              ) : (
                <Link href={`${basePath}/tasks`}>
                  <Button size="sm" variant="outline">
                    Manage task list →
                  </Button>
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {taskCount === 0 ? (
                <p className="text-sm text-slate-500">
                  No tasks. Open the task manager to add tasks and capture per-person sign-offs.
                </p>
              ) : (
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {taskCount} active {taskCount === 1 ? 'task' : 'tasks'}. Open the task manager to
                  search, edit, reorder, archive, and review acknowledgements.
                </p>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageContainer>
  )
}
