import { notFound } from 'next/navigation'
import Link from 'next/link'
import { FileText, IdCard, Printer, Trash2, Users } from 'lucide-react'
import { asc, eq } from 'drizzle-orm'
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
import { requireModuleManage } from '@/lib/module-admin/guard'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { deleteTitle, unassignTitleFromPerson, updateTitle } from '../../_actions/titles'

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
  const sp = await searchParams
  const active = pickActiveTab(sp, TABS, 'description')

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
      .select({
        assignment: personTitleAssignments,
        person: people,
      })
      .from(personTitleAssignments)
      .innerJoin(people, eq(people.id, personTitleAssignments.personId))
      .where(eq(personTitleAssignments.titleId, id))
      .orderBy(asc(people.lastName), asc(people.firstName))
    return { row, tasks, assignments }
  })
  if (!data) notFound()
  const { row, tasks, assignments } = data

  const basePath = `/people/titles/${row.id}`

  return (
    <PageContainer>
      <div className="space-y-5">
        <DetailHeader
          back={{ href: '/people/titles', label: 'Back to titles' }}
          title={row.name}
          subtitle={row.description ?? undefined}
          badge={<Badge variant="secondary">{assignments.length} assigned</Badge>}
          actions={
            <>
              <Link href={`${basePath}/pdf`} target="_blank">
                <Button variant="outline">
                  <Printer size={14} />
                  Job Description PDF
                </Button>
              </Link>
              <form action={deleteTitle}>
                <input type="hidden" name="id" value={row.id} />
                <Button
                  type="submit"
                  variant="outline"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700"
                >
                  <Trash2 size={14} />
                  Delete
                </Button>
              </form>
            </>
          }
        />

        <TabNav
          basePath={basePath}
          currentParams={sp}
          active={active}
          tabs={[
            { key: 'description', label: 'Job Description' },
            { key: 'people', label: 'Assigned people', count: assignments.length },
            { key: 'tasks', label: 'Tasks', count: tasks.length },
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
                  <Input id="name" name="name" defaultValue={row.name} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="description">Scope</Label>
                  <Textarea
                    id="description"
                    name="description"
                    rows={3}
                    defaultValue={row.description ?? ''}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="responsibilities">Responsibilities</Label>
                  <Textarea
                    id="responsibilities"
                    name="responsibilities"
                    rows={6}
                    defaultValue={row.responsibilities ?? ''}
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
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="experience">Experience</Label>
                    <Textarea
                      id="experience"
                      name="experience"
                      rows={4}
                      defaultValue={row.experience ?? ''}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="submit">Save Job Description</Button>
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
            <CardContent>
              {assignments.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No one assigned. Assign this title from a person's Title tab.
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
            </CardContent>
          </Card>
        ) : null}

        {active === 'tasks' ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText size={16} />
                Job-description tasks
                <Badge variant="secondary">{tasks.length}</Badge>
              </CardTitle>
              <Link href={`${basePath}/tasks`}>
                <Button size="sm" variant="outline">
                  Manage task list →
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No tasks. Open the task manager to add tasks and capture per-person sign-offs.
                </p>
              ) : (
                <ol className="space-y-1 text-sm">
                  {tasks.map((t, i) => (
                    <li
                      key={t.id}
                      className="flex items-start gap-3 rounded border border-slate-100 px-3 py-2"
                    >
                      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">{t.task}</div>
                        {t.description ? (
                          <div className="text-xs text-slate-500">{t.description}</div>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </PageContainer>
  )
}
