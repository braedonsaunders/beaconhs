import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { getGeneratedTranslations } from '@/i18n/generated.server'
import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_072ab3e0c31269', { value0: id.slice(0, 8) }) }
}

export default async function TitleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
          title={tGeneratedValue(row.name)}
          subtitle={tGeneratedValue(row.description ?? undefined)}
          badge={
            <span className="flex items-center gap-2">
              <GeneratedValue
                value={
                  row.deletedAt ? (
                    <Badge variant="secondary">
                      <GeneratedText id="m_12a687134482ba" />
                    </Badge>
                  ) : null
                }
              />
              <Badge variant="secondary">
                <GeneratedValue value={assignmentCount} /> <GeneratedText id="m_1ad9a6529af849" />
              </Badge>
            </span>
          }
          actions={
            <>
              <GeneratedValue
                value={
                  row.deletedAt ? null : (
                    <Link href={`${basePath}/pdf`} target="_blank">
                      <Button variant="outline">
                        <Printer size={14} />
                        <GeneratedText id="m_19bacf0b200481" />
                      </Button>
                    </Link>
                  )
                }
              />
              <GeneratedValue
                value={
                  row.deletedAt ? (
                    <form action={restoreTitle}>
                      <input type="hidden" name="id" value={row.id} />
                      <Button type="submit" variant="outline">
                        <GeneratedText id="m_19500e41842c99" />
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
                        <GeneratedText id="m_019c0a64030688" />
                      </Button>
                    </form>
                  )
                }
              />
            </>
          }
        />

        <GeneratedValue
          value={
            errorMessage ? (
              <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
                <GeneratedValue value={errorMessage} />
              </p>
            ) : null
          }
        />

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

        <GeneratedValue
          value={
            active === 'description' ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <IdCard size={16} />
                    <GeneratedText id="m_02a4fc25a429a2" />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={updateTitle} className="space-y-4">
                    <input type="hidden" name="id" value={row.id} />
                    <div className="space-y-1.5">
                      <Label htmlFor="name">
                        <GeneratedText id="m_1a9978900838e6" />
                      </Label>
                      <Input
                        id="name"
                        name="name"
                        defaultValue={row.name}
                        required
                        disabled={Boolean(row.deletedAt)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="description">
                        <GeneratedText id="m_1f10a46fc1db73" />
                      </Label>
                      <Textarea
                        id="description"
                        name="description"
                        rows={3}
                        defaultValue={row.description ?? ''}
                        disabled={Boolean(row.deletedAt)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="responsibilities">
                        <GeneratedText id="m_10db3552a638bc" />
                      </Label>
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
                        <Label htmlFor="education">
                          <GeneratedText id="m_01f50b9a132c18" />
                        </Label>
                        <Textarea
                          id="education"
                          name="education"
                          rows={4}
                          defaultValue={row.education ?? ''}
                          disabled={Boolean(row.deletedAt)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="experience">
                          <GeneratedText id="m_054359abce46c6" />
                        </Label>
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
                        <GeneratedText id="m_1db2d11fc2f63f" />
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'people' ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Users size={16} />
                    <GeneratedText id="m_1d0e403edd7f5a" />
                    <Badge variant="secondary">
                      <GeneratedValue value={assignments.length} />
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <SearchInput
                    placeholder={tGenerated('m_10e9a56b2c55ef')}
                    paramKey="personQ"
                    pageParamKey="personPage"
                  />
                  <GeneratedValue
                    value={
                      assignments.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          <GeneratedValue
                            value={
                              personParams.q ? (
                                <GeneratedText id="m_153be2ed250b6f" />
                              ) : (
                                <GeneratedText id="m_031b590513e3cc" />
                              )
                            }
                          />
                        </p>
                      ) : (
                        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          <GeneratedValue
                            value={assignments.map(({ assignment, person }) => (
                              <li
                                key={assignment.id}
                                className="flex items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2"
                              >
                                <Link
                                  href={`/people/${person.id}`}
                                  className="flex-1 hover:underline"
                                >
                                  <span className="block text-sm font-medium">
                                    <GeneratedValue value={person.lastName} />,{' '}
                                    <GeneratedValue value={person.firstName} />
                                  </span>
                                  <GeneratedValue
                                    value={
                                      person.employeeNo ? (
                                        <span className="text-xs text-slate-500">
                                          {person.employeeNo}
                                        </span>
                                      ) : null
                                    }
                                  />
                                </Link>
                                <GeneratedValue
                                  value={
                                    assignment.isPrimary ? (
                                      <Badge variant="success">
                                        <GeneratedText id="m_18aec830eeb5e0" />
                                      </Badge>
                                    ) : null
                                  }
                                />
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
                          />
                        </ul>
                      )
                    }
                  />
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
            ) : null
          }
        />

        <GeneratedValue
          value={
            active === 'tasks' ? (
              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText size={16} />
                    <GeneratedText id="m_0aeddda6c35547" />
                    <Badge variant="secondary">
                      <GeneratedValue value={taskCount} />
                    </Badge>
                  </CardTitle>
                  <GeneratedValue
                    value={
                      row.deletedAt ? (
                        <Button size="sm" variant="outline" disabled>
                          <GeneratedText id="m_1b7194f0ac00a0" />
                        </Button>
                      ) : (
                        <Link href={`${basePath}/tasks`}>
                          <Button size="sm" variant="outline">
                            <GeneratedText id="m_0a252ab0b9cb98" />
                          </Button>
                        </Link>
                      )
                    }
                  />
                </CardHeader>
                <CardContent>
                  <GeneratedValue
                    value={
                      taskCount === 0 ? (
                        <p className="text-sm text-slate-500">
                          <GeneratedText id="m_07c3d34b0d33e6" />
                        </p>
                      ) : (
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          <GeneratedValue value={taskCount} />{' '}
                          <GeneratedText id="m_0af64d5dc843c0" />{' '}
                          <GeneratedValue
                            value={
                              taskCount === 1 ? (
                                <GeneratedText id="m_0bec4d9de7885e" />
                              ) : (
                                <GeneratedText id="m_08416244f157a0" />
                              )
                            }
                          />
                          <GeneratedText id="m_17f017ae36c7fc" />
                        </p>
                      )
                    }
                  />
                </CardContent>
              </Card>
            ) : null
          }
        />
      </div>
    </PageContainer>
  )
}
