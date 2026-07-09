import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  CheckSquare,
  FileText,
  Pencil,
  Plus,
  Square,
  Trash2,
} from 'lucide-react'
import { asc, eq, inArray } from 'drizzle-orm'
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
import { formatDate } from '@/lib/datetime'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import {
  acknowledgeTitleTask,
  addTitleTask,
  deleteTitleTask,
  reorderTitleTask,
  revokeTitleTaskAck,
  updateTitleTask,
} from '../../../_actions/titles'

export const dynamic = 'force-dynamic'

const TABS = ['manage', 'matrix'] as const

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
  const sp = await searchParams
  const active = pickActiveTab(sp, TABS, 'manage')
  const editTaskId = typeof sp.edit === 'string' ? sp.edit : null

  const ctx = await requireModuleManage('people')
  const data = await ctx.db(async (tx) => {
    const [row] = await tx.select().from(personTitles).where(eq(personTitles.id, id)).limit(1)
    if (!row) return null
    const tasks = await tx
      .select()
      .from(jobTitleTasks)
      .where(eq(jobTitleTasks.titleId, id))
      .orderBy(asc(jobTitleTasks.entityOrder), asc(jobTitleTasks.createdAt))
    const assignments = await tx
      .select({ assignment: personTitleAssignments, person: people })
      .from(personTitleAssignments)
      .innerJoin(people, eq(people.id, personTitleAssignments.personId))
      .where(eq(personTitleAssignments.titleId, id))
      .orderBy(asc(people.lastName), asc(people.firstName))
    const taskIds = tasks.map((t) => t.id)
    const acks =
      taskIds.length > 0
        ? await tx
            .select()
            .from(jobTitleTaskAcknowledgments)
            .where(inArray(jobTitleTaskAcknowledgments.taskId, taskIds))
        : []
    return { row, tasks, assignments, acks }
  })
  if (!data) notFound()
  const { row, tasks, assignments, acks } = data

  // Build the lookup map: taskId|personId -> ack
  const ackMap = new Map<string, (typeof acks)[number]>()
  for (const a of acks) ackMap.set(`${a.taskId}|${a.personId}`, a)

  // Per-person completion stats for the matrix view
  const totalTasks = tasks.length
  const perPersonComplete = new Map<string, number>()
  for (const { person } of assignments) {
    let n = 0
    for (const t of tasks) if (ackMap.has(`${t.id}|${person.id}`)) n += 1
    perPersonComplete.set(person.id, n)
  }

  const basePath = `/people/titles/${row.id}/tasks`
  const editing = editTaskId ? tasks.find((t) => t.id === editTaskId) : null

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: `/people/titles/${row.id}`, label: 'Back to title' }}
          title={`${row.name} — Tasks`}
          subtitle={`Manage the job-description task list and review who has signed off.`}
        />
        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'manage', label: 'Manage tasks', count: tasks.length },
            {
              key: 'matrix',
              label: 'Acknowledgement matrix',
              count: assignments.length,
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
                  <Badge variant="secondary">{tasks.length}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {tasks.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No tasks. Add one with the form on the right.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {tasks.map((t, i) => {
                      const isEditing = editing?.id === t.id
                      const ackCount = acks.filter((a) => a.taskId === t.id).length
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
                                disabled={i === 0}
                                className="h-6 w-6 p-0"
                              >
                                <ArrowUp size={12} />
                              </Button>
                            </form>
                            <span className="text-xs font-medium text-slate-400">{i + 1}</span>
                            <form action={reorderTitleTask}>
                              <input type="hidden" name="id" value={t.id} />
                              <input type="hidden" name="direction" value="down" />
                              <Button
                                type="submit"
                                size="sm"
                                variant="ghost"
                                disabled={i === tasks.length - 1}
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
                                <Link href={basePath}>
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
                                {ackCount}/{assignments.length} acknowledged
                              </div>
                            </div>
                          )}
                          <div className="flex shrink-0 gap-1">
                            <Link href={`${basePath}?edit=${t.id}`}>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                                <Pencil size={12} />
                              </Button>
                            </Link>
                            <form action={deleteTitleTask}>
                              <input type="hidden" name="id" value={t.id} />
                              <Button
                                type="submit"
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-500 hover:text-red-700"
                              >
                                <Trash2 size={12} />
                              </Button>
                            </form>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </CardContent>
            </Card>

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
          </div>
        ) : null}

        {active === 'matrix' ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Acknowledgement matrix</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {assignments.length === 0 || tasks.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {assignments.length === 0
                    ? 'No one assigned to this title.'
                    : 'No tasks defined.'}
                </p>
              ) : (
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
                            {i + 1}. {t.task.slice(0, 40)}
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
                                      title={`Acknowledged ${formatDate(new Date(ack.acknowledgedAt), ctx.timezone)} — click to revoke`}
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
                            <Badge variant={done === totalTasks ? 'success' : 'secondary'}>
                              {done}/{totalTasks}
                            </Badge>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageContainer>
  )
}
