import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  Archive,
  CheckSquare,
  FileText,
  Pencil,
  Plus,
  Square,
} from 'lucide-react'
import { and, asc, count, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
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
import {
  jobTitleTaskAcknowledgments,
  jobTitleTasks,
  people,
  personTitleAssignments,
  personTitles,
} from '@beaconhs/db/schema'
import { PageContainer } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { FilterChips } from '@/components/filter-bar'
import { formatDate } from '@/lib/datetime'
import { isUuid, mergeHref, parseListParams } from '@/lib/list-params'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  acknowledgeTitleTask,
  addTitleTask,
  archiveTitleTask,
  reorderTitleTask,
  restoreTitleTask,
  revokeTitleTaskAck,
  updateTitleTask,
} from '../../../_actions/titles'

export const dynamic = 'force-dynamic'

const TABS = ['manage', 'matrix'] as const
const TASK_SORTS = ['order'] as const
const PERSON_SORTS = ['person'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Title tasks · ${id.slice(0, 8)}` }
}

export default async function TitleTasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()

  const sp = await searchParams
  const active = pickActiveTab(sp, TABS, 'manage')
  const errorMessage = typeof sp.error === 'string' ? sp.error : null
  const requestedTaskStatus =
    sp.taskStatus === 'archived' || sp.taskStatus === 'all' ? sp.taskStatus : 'active'
  const taskStatus = active === 'matrix' ? 'active' : requestedTaskStatus
  const requestedEditTaskId = typeof sp.edit === 'string' ? sp.edit : null
  const editTaskId = requestedEditTaskId && isUuid(requestedEditTaskId) ? requestedEditTaskId : null
  const taskParams = parseListParams(
    {
      q: sp.taskQ,
      sort: sp.taskSort,
      dir: sp.taskDir,
      page: sp.taskPage,
      perPage: sp.taskPerPage,
    },
    { sort: 'order', dir: 'asc', perPage: 20, allowedSorts: TASK_SORTS },
  )
  const personParams = parseListParams(
    {
      q: sp.personQ,
      sort: sp.personSort,
      dir: sp.personDir,
      page: sp.personPage,
      perPage: sp.personPerPage,
    },
    { sort: 'person', dir: 'asc', perPage: 20, allowedSorts: PERSON_SORTS },
  )

  const ctx = await requireModuleManage('people')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx
      .select()
      .from(personTitles)
      .where(and(eq(personTitles.id, id), isNull(personTitles.deletedAt)))
      .limit(1)
    if (!row) return null
    const taskBase = and(
      eq(jobTitleTasks.titleId, id),
      taskStatus === 'active'
        ? isNull(jobTitleTasks.deletedAt)
        : taskStatus === 'archived'
          ? isNotNull(jobTitleTasks.deletedAt)
          : undefined,
    )
    const taskSearch = taskParams.q
      ? or(
          ilike(jobTitleTasks.task, `%${taskParams.q}%`),
          ilike(jobTitleTasks.description, `%${taskParams.q}%`),
        )
      : undefined
    const taskWhere = and(taskBase, taskSearch)
    const assignmentBase = and(eq(personTitleAssignments.titleId, id), isNull(people.deletedAt))
    const personSearch = personParams.q
      ? or(
          ilike(people.firstName, `%${personParams.q}%`),
          ilike(people.lastName, `%${personParams.q}%`),
          ilike(people.employeeNo, `%${personParams.q}%`),
        )
      : undefined
    const assignmentWhere = and(assignmentBase, personSearch)

    const [[taskCountRow], [filteredTaskCountRow], [assignmentCountRow]] = await Promise.all([
      tx.select({ c: count() }).from(jobTitleTasks).where(taskBase),
      tx.select({ c: count() }).from(jobTitleTasks).where(taskWhere),
      tx
        .select({ c: count() })
        .from(personTitleAssignments)
        .innerJoin(people, eq(people.id, personTitleAssignments.personId))
        .where(assignmentBase),
    ])
    const taskCount = Number(taskCountRow?.c ?? 0)
    const filteredTaskCount = Number(filteredTaskCountRow?.c ?? 0)
    const assignmentCount = Number(assignmentCountRow?.c ?? 0)

    const tasks = await tx
      .select()
      .from(jobTitleTasks)
      .where(taskWhere)
      .orderBy(asc(jobTitleTasks.entityOrder), asc(jobTitleTasks.createdAt))
      .limit(taskParams.perPage)
      .offset((taskParams.page - 1) * taskParams.perPage)

    const assignments =
      active === 'matrix'
        ? await tx
            .select({ assignment: personTitleAssignments, person: people })
            .from(personTitleAssignments)
            .innerJoin(people, eq(people.id, personTitleAssignments.personId))
            .where(assignmentWhere)
            .orderBy(asc(people.lastName), asc(people.firstName))
            .limit(personParams.perPage)
            .offset((personParams.page - 1) * personParams.perPage)
        : []
    const [filteredAssignmentCountRow] =
      active === 'matrix'
        ? await tx
            .select({ c: count() })
            .from(personTitleAssignments)
            .innerJoin(people, eq(people.id, personTitleAssignments.personId))
            .where(assignmentWhere)
        : [{ c: assignmentCount }]
    const filteredAssignmentCount = Number(filteredAssignmentCountRow?.c ?? 0)

    const taskIds = tasks.map((t) => t.id)
    const personIds = assignments.map(({ person }) => person.id)
    const acks =
      active === 'matrix' && taskIds.length > 0 && personIds.length > 0
        ? await tx
            .select()
            .from(jobTitleTaskAcknowledgments)
            .where(
              and(
                inArray(jobTitleTaskAcknowledgments.taskId, taskIds),
                inArray(jobTitleTaskAcknowledgments.personId, personIds),
              ),
            )
        : []
    const ackCounts =
      active === 'manage' && taskIds.length > 0
        ? await tx
            .select({
              taskId: jobTitleTaskAcknowledgments.taskId,
              c: count(),
            })
            .from(jobTitleTaskAcknowledgments)
            .innerJoin(
              personTitleAssignments,
              and(
                eq(personTitleAssignments.personId, jobTitleTaskAcknowledgments.personId),
                eq(personTitleAssignments.titleId, id),
              ),
            )
            .where(inArray(jobTitleTaskAcknowledgments.taskId, taskIds))
            .groupBy(jobTitleTaskAcknowledgments.taskId)
        : []
    const personCompletion =
      active === 'matrix' && personIds.length > 0
        ? await tx
            .select({
              personId: jobTitleTaskAcknowledgments.personId,
              c: sql<number>`count(distinct ${jobTitleTaskAcknowledgments.taskId})`.mapWith(Number),
            })
            .from(jobTitleTaskAcknowledgments)
            .innerJoin(jobTitleTasks, eq(jobTitleTasks.id, jobTitleTaskAcknowledgments.taskId))
            .where(
              and(
                eq(jobTitleTasks.titleId, id),
                isNull(jobTitleTasks.deletedAt),
                inArray(jobTitleTaskAcknowledgments.personId, personIds),
              ),
            )
            .groupBy(jobTitleTaskAcknowledgments.personId)
        : []
    const [editing] =
      editTaskId && active === 'manage'
        ? await tx
            .select()
            .from(jobTitleTasks)
            .where(and(eq(jobTitleTasks.id, editTaskId), taskBase))
            .limit(1)
        : [undefined]
    return {
      row,
      tasks,
      taskCount,
      filteredTaskCount,
      assignments,
      assignmentCount,
      filteredAssignmentCount,
      acks,
      ackCounts,
      personCompletion,
      editing: editing ?? null,
    }
  })
  if (!data) notFound()
  const {
    row,
    tasks,
    taskCount,
    filteredTaskCount,
    assignments,
    assignmentCount,
    filteredAssignmentCount,
    acks,
    ackCounts,
    personCompletion,
    editing,
  } = data

  // Build the lookup map: taskId|personId -> ack
  const ackMap = new Map<string, (typeof acks)[number]>()
  for (const a of acks) ackMap.set(`${a.taskId}|${a.personId}`, a)

  const ackCountByTask = new Map(ackCounts.map((item) => [item.taskId, Number(item.c)]))
  const perPersonComplete = new Map(personCompletion.map((item) => [item.personId, Number(item.c)]))

  const basePath = `/people/titles/${row.id}/tasks`
  const closeEditHref = mergeHref(basePath, sp, { edit: undefined })

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: `/people/titles/${row.id}`, label: 'Back to title' }}
          title={`${row.name} — Tasks`}
          subtitle={`Manage the job-description task list and review who has signed off.`}
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
            { key: 'manage', label: 'Manage tasks', count: taskCount },
            {
              key: 'matrix',
              label: 'Acknowledgement matrix',
              count: assignmentCount,
            },
          ]}
        />

        {active === 'manage' ? (
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText size={16} />
                  Tasks
                  <Badge variant="secondary">{taskCount}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <TableToolbar>
                  <SearchInput
                    placeholder="Search tasks…"
                    paramKey="taskQ"
                    pageParamKey="taskPage"
                  />
                  <FilterChips
                    basePath={basePath}
                    currentParams={sp}
                    paramKey="taskStatus"
                    label="Status"
                    defaultValue="active"
                    pageParamKey="taskPage"
                    options={[
                      { value: 'active', label: 'Active' },
                      { value: 'archived', label: 'Archived' },
                    ]}
                    allLabel="All"
                  />
                </TableToolbar>
                {tasks.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {taskParams.q
                      ? 'No tasks match your search.'
                      : 'No tasks. Add one with the form on the right.'}
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {tasks.map((t, i) => {
                      const isEditing = !t.deletedAt && editing?.id === t.id
                      const ackCount = ackCountByTask.get(t.id) ?? 0
                      const position = (taskParams.page - 1) * taskParams.perPage + i
                      return (
                        <li
                          key={t.id}
                          className="flex items-start gap-3 rounded border border-slate-200 px-3 py-2 dark:border-slate-800"
                        >
                          <div className="flex shrink-0 flex-col items-center gap-1 pt-1">
                            <form action={reorderTitleTask}>
                              <input type="hidden" name="id" value={t.id} />
                              <input type="hidden" name="direction" value="up" />
                              <Button
                                type="submit"
                                size="sm"
                                variant="ghost"
                                disabled={
                                  Boolean(t.deletedAt) || Boolean(taskParams.q) || position === 0
                                }
                                className="h-6 w-6 p-0"
                              >
                                <ArrowUp size={12} />
                              </Button>
                            </form>
                            <span className="text-xs font-medium text-slate-400">
                              {position + 1}
                            </span>
                            <form action={reorderTitleTask}>
                              <input type="hidden" name="id" value={t.id} />
                              <input type="hidden" name="direction" value="down" />
                              <Button
                                type="submit"
                                size="sm"
                                variant="ghost"
                                disabled={
                                  Boolean(t.deletedAt) ||
                                  Boolean(taskParams.q) ||
                                  position >= taskCount - 1
                                }
                                className="h-6 w-6 p-0"
                              >
                                <ArrowDown size={12} />
                              </Button>
                            </form>
                          </div>
                          {isEditing ? (
                            <form action={updateTitleTask} className="flex-1 space-y-2">
                              <input type="hidden" name="id" value={t.id} />
                              <Input
                                name="task"
                                defaultValue={t.task}
                                placeholder="Task statement"
                              />
                              <Textarea
                                name="description"
                                rows={2}
                                defaultValue={t.description ?? ''}
                                placeholder="Optional supporting detail"
                              />
                              <div className="flex gap-2">
                                <Button type="submit" size="sm">
                                  Save
                                </Button>
                                <Link href={closeEditHref as never}>
                                  <Button type="button" size="sm" variant="outline">
                                    Cancel
                                  </Button>
                                </Link>
                              </div>
                            </form>
                          ) : (
                            <div className="min-w-0 flex-1">
                              <div className="font-medium text-slate-900 dark:text-slate-100">
                                {t.task}
                              </div>
                              {t.description ? (
                                <div className="text-xs text-slate-500 dark:text-slate-400">
                                  {t.description}
                                </div>
                              ) : null}
                              <div className="mt-1 text-xs text-slate-400">
                                {ackCount}/{assignmentCount} acknowledged
                              </div>
                            </div>
                          )}
                          <div className="flex shrink-0 gap-1">
                            {t.deletedAt ? (
                              <form action={restoreTitleTask}>
                                <input type="hidden" name="id" value={t.id} />
                                <Button type="submit" size="sm" variant="outline">
                                  Restore
                                </Button>
                              </form>
                            ) : (
                              <>
                                <Link href={mergeHref(basePath, sp, { edit: t.id }) as never}>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                    <Pencil size={12} />
                                  </Button>
                                </Link>
                                <form action={archiveTitleTask}>
                                  <input type="hidden" name="id" value={t.id} />
                                  <Button
                                    type="submit"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                                  >
                                    <Archive size={12} />
                                  </Button>
                                </form>
                              </>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
                <Pagination
                  basePath={basePath}
                  currentParams={sp}
                  total={filteredTaskCount}
                  page={taskParams.page}
                  perPage={taskParams.perPage}
                  pageParamKey="taskPage"
                />
              </CardContent>
            </Card>

            {taskStatus === 'active' ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Plus size={14} />
                    Add task
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={addTitleTask} className="space-y-3">
                    <input type="hidden" name="titleId" value={row.id} />
                    <div className="space-y-1.5">
                      <Label htmlFor="task">Task *</Label>
                      <Input
                        id="task"
                        name="task"
                        required
                        placeholder="e.g. Perform daily harness inspection"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="description">Detail (optional)</Label>
                      <Textarea
                        id="description"
                        name="description"
                        rows={3}
                        placeholder="Anything the worker should know to perform the task safely."
                      />
                    </div>
                    <Button type="submit" className="w-full">
                      Add task
                    </Button>
                  </form>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Archived task history</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Restore a task from the list before editing it or collecting new
                    acknowledgements.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        ) : null}

        {active === 'matrix' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acknowledgement matrix</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <TableToolbar>
                <SearchInput placeholder="Search tasks…" paramKey="taskQ" pageParamKey="taskPage" />
                <SearchInput
                  placeholder="Search people…"
                  paramKey="personQ"
                  pageParamKey="personPage"
                />
              </TableToolbar>
              {assignments.length === 0 || tasks.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {assignmentCount === 0
                    ? 'No one is assigned to this title.'
                    : taskCount === 0
                      ? 'No tasks are defined.'
                      : 'No matrix rows match these searches.'}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-left dark:border-slate-800">
                        <th className="sticky left-0 z-10 bg-white px-2 py-2 font-semibold text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                          Person
                        </th>
                        {tasks.map((t, i) => (
                          <th
                            key={t.id}
                            className="px-1 py-2 text-center font-normal text-slate-500 dark:text-slate-400"
                            title={t.task}
                          >
                            <div className="rotate-180 text-[10px] [writing-mode:vertical-rl]">
                              {(taskParams.page - 1) * taskParams.perPage + i + 1}.{' '}
                              {t.task.slice(0, 40)}
                            </div>
                          </th>
                        ))}
                        <th className="px-2 py-2 text-right font-semibold text-slate-500 dark:text-slate-400">
                          Done
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {assignments.map(({ person }) => {
                        const done = perPersonComplete.get(person.id) ?? 0
                        return (
                          <tr
                            key={person.id}
                            className="border-b border-slate-100 dark:border-slate-800"
                          >
                            <td className="sticky left-0 z-10 bg-white px-2 py-1 dark:bg-slate-900">
                              <Link
                                href={`/people/${person.id}?tab=title`}
                                className="font-medium hover:underline"
                              >
                                {person.lastName}, {person.firstName}
                              </Link>
                            </td>
                            {tasks.map((t) => {
                              const ack = ackMap.get(`${t.id}|${person.id}`)
                              return (
                                <td key={t.id} className="px-1 py-1 text-center">
                                  {ack ? (
                                    <form action={revokeTitleTaskAck} className="inline-flex">
                                      <input type="hidden" name="taskId" value={t.id} />
                                      <input type="hidden" name="personId" value={person.id} />
                                      <button
                                        type="submit"
                                        title={`Acknowledged ${formatDate(new Date(ack.acknowledgedAt), ctx.timezone, ctx.locale)} — click to revoke`}
                                        className="text-emerald-600 hover:text-emerald-800"
                                      >
                                        <CheckSquare size={14} />
                                      </button>
                                    </form>
                                  ) : (
                                    <form action={acknowledgeTitleTask} className="inline-flex">
                                      <input type="hidden" name="taskId" value={t.id} />
                                      <input type="hidden" name="personId" value={person.id} />
                                      <button
                                        type="submit"
                                        title="Mark acknowledged"
                                        className="text-slate-300 hover:text-slate-500"
                                      >
                                        <Square size={14} />
                                      </button>
                                    </form>
                                  )}
                                </td>
                              )
                            })}
                            <td className="px-2 py-1 text-right">
                              <Badge variant={done === taskCount ? 'success' : 'secondary'}>
                                {done}/{taskCount}
                              </Badge>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="grid gap-2 lg:grid-cols-2">
                <div>
                  <p className="px-3 pt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Task columns
                  </p>
                  <Pagination
                    basePath={basePath}
                    currentParams={sp}
                    total={filteredTaskCount}
                    page={taskParams.page}
                    perPage={taskParams.perPage}
                    pageParamKey="taskPage"
                  />
                </div>
                <div>
                  <p className="px-3 pt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                    People rows
                  </p>
                  <Pagination
                    basePath={basePath}
                    currentParams={sp}
                    total={filteredAssignmentCount}
                    page={personParams.page}
                    perPage={personParams.perPage}
                    pageParamKey="personPage"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageContainer>
  )
}
