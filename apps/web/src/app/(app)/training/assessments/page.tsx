import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { and, asc, count, desc, eq, ilike, isNull, ne, or, sql, type SQL } from 'drizzle-orm'
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
  UrlDrawer,
} from '@beaconhs/ui'
import {
  people,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCourses,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatDate, formatDateTime } from '@/lib/datetime'
import { moduleScopeWhere } from '@/lib/visibility'
import { isUuid, mergeHref, parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { SearchInput } from '@/components/search-input'
import { RemoteSearchFilter } from '@/components/remote-search-select'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../_components/training-sub-nav'
import { startAssessmentAttempt } from '../_actions/assessments'
import { NewTrainingAssessmentDrawer } from './_new-assessment-drawer'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_037a7504abbf0b') }
}
export const dynamic = 'force-dynamic'

const SORTS = ['completed', 'person', 'type', 'score'] as const

function parseCalendarDate(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  // PostgreSQL has no year zero; keep malformed query-string dates out of
  // typed `date` comparisons instead of allowing the request to fail.
  if (value.startsWith('0000-')) return undefined
  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    return undefined
  }
  return value
}

const STATUS_OPTIONS = [
  { value: 'in_progress', label: 'In progress' },
  { value: 'awaiting_review', label: 'Awaiting review' },
  { value: 'completed', label: 'Completed' },
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'completed',
    dir: 'desc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const statusFilter = pickString(sp.status) ?? 'all'
  const personFilter = pickString(sp.person)
  const typeFilter = pickString(sp.type)
  const courseFilter = pickString(sp.course)
  const dateFromRaw = pickString(sp.dateFrom)
  const dateToRaw = pickString(sp.dateTo)
  const drawerKey = pickString(sp.drawer)
  const requestedTypeId = pickString(sp.typeId)
  const dateFrom = parseCalendarDate(dateFromRaw)
  const dateTo = parseCalendarDate(dateToRaw)
  const ctx = await requireRequestContext()
  // Attempts are person-scoped records: viewing them requires a training read
  // tier. Proctors (training.record.create / training.class.manage) run
  // attempts for other people, so either staff permission grants all-visibility;
  // read.self holders are scoped to their own attempts by moduleScopeWhere
  // below. No qualifying permission at all → 404, mirroring /training/records.
  const isProctor = can(ctx, 'training.record.create') || can(ctx, 'training.class.manage')
  if (
    !ctx.isSuperAdmin &&
    !isProctor &&
    !can(ctx, 'training.read.all') &&
    !can(ctx, 'training.read.self')
  )
    notFound()

  const { rows, total, statusCounts } = await ctx.db(async (tx) => {
    const vis = isProctor
      ? undefined
      : await moduleScopeWhere(ctx, tx, {
          prefix: 'training',
          personCol: trainingAssessments.personId,
        })
    const filters: SQL<unknown>[] = []
    filters.push(isNull(trainingAssessments.deletedAt))
    if (vis) filters.push(vis)
    if (params.q) {
      const term = `%${params.q}%`
      const search = or(
        ilike(people.firstName, term),
        ilike(people.lastName, term),
        ilike(people.employeeNo, term),
        ilike(trainingAssessmentTypes.name, term),
        ilike(trainingCourses.name, term),
        ilike(trainingCourses.code, term),
      )
      if (search) filters.push(search)
    }
    if (statusFilter === 'in_progress') {
      filters.push(eq(trainingAssessments.status, 'in_progress'))
      filters.push(ne(trainingAssessments.reviewStatus, 'pending'))
    } else if (statusFilter === 'awaiting_review') {
      filters.push(eq(trainingAssessments.status, 'in_progress'))
      filters.push(eq(trainingAssessments.reviewStatus, 'pending'))
    } else if (statusFilter === 'completed') {
      filters.push(eq(trainingAssessments.status, 'submitted'))
      filters.push(eq(trainingAssessments.graded, false))
    } else if (statusFilter === 'cancelled') {
      filters.push(eq(trainingAssessments.status, 'cancelled'))
    } else if (statusFilter === 'pass') {
      filters.push(eq(trainingAssessments.status, 'submitted'))
      filters.push(eq(trainingAssessments.graded, true))
      filters.push(eq(trainingAssessments.passed, true))
    } else if (statusFilter === 'fail') {
      filters.push(eq(trainingAssessments.status, 'submitted'))
      filters.push(eq(trainingAssessments.graded, true))
      filters.push(eq(trainingAssessments.passed, false))
    }
    if (personFilter && isUuid(personFilter))
      filters.push(eq(trainingAssessments.personId, personFilter))
    if (typeFilter && isUuid(typeFilter)) filters.push(eq(trainingAssessments.typeId, typeFilter))
    if (courseFilter && isUuid(courseFilter))
      filters.push(eq(trainingAssessments.courseId, courseFilter))
    if (dateFrom) {
      filters.push(
        sql`coalesce(${trainingAssessments.completedAt}, ${trainingAssessments.startedAt})::date >= ${dateFrom}`,
      )
    }
    if (dateTo) {
      filters.push(
        sql`coalesce(${trainingAssessments.completedAt}, ${trainingAssessments.startedAt})::date <= ${dateTo}`,
      )
    }
    const whereClause = filters.length > 0 ? and(...filters) : undefined

    const orderBy =
      params.sort === 'person'
        ? [params.dir === 'asc' ? asc(people.lastName) : desc(people.lastName)]
        : params.sort === 'type'
          ? [
              params.dir === 'asc'
                ? asc(trainingAssessmentTypes.name)
                : desc(trainingAssessmentTypes.name),
            ]
          : params.sort === 'score'
            ? [
                params.dir === 'asc'
                  ? asc(trainingAssessments.score)
                  : desc(trainingAssessments.score),
              ]
            : [
                params.dir === 'asc'
                  ? asc(trainingAssessments.completedAt)
                  : desc(trainingAssessments.completedAt),
              ]

    const [tot] = await tx
      .select({ c: count() })
      .from(trainingAssessments)
      .innerJoin(
        trainingAssessmentTypes,
        eq(trainingAssessmentTypes.id, trainingAssessments.typeId),
      )
      .innerJoin(people, eq(people.id, trainingAssessments.personId))
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAssessments.courseId))
      .where(whereClause)
    const data = await tx
      .select({
        attempt: trainingAssessments,
        type: trainingAssessmentTypes,
        person: people,
        course: trainingCourses,
      })
      .from(trainingAssessments)
      .innerJoin(
        trainingAssessmentTypes,
        eq(trainingAssessmentTypes.id, trainingAssessments.typeId),
      )
      .innerJoin(people, eq(people.id, trainingAssessments.personId))
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAssessments.courseId))
      .where(whereClause)
      .orderBy(...orderBy, desc(trainingAssessments.id))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const counts = await tx
      .select({
        status: trainingAssessments.status,
        reviewStatus: trainingAssessments.reviewStatus,
        graded: trainingAssessments.graded,
        passed: trainingAssessments.passed,
        c: count(),
      })
      .from(trainingAssessments)
      .where(and(isNull(trainingAssessments.deletedAt), vis))
      .groupBy(
        trainingAssessments.status,
        trainingAssessments.reviewStatus,
        trainingAssessments.graded,
        trainingAssessments.passed,
      )

    const sc: Record<string, number> = {
      all: 0,
      in_progress: 0,
      awaiting_review: 0,
      completed: 0,
      pass: 0,
      fail: 0,
      cancelled: 0,
    }
    for (const c of counts) {
      sc.all = (sc.all ?? 0) + Number(c.c)
      if (c.status === 'in_progress' && c.reviewStatus === 'pending') {
        sc.awaiting_review = (sc.awaiting_review ?? 0) + Number(c.c)
      } else if (c.status === 'in_progress') {
        sc.in_progress = (sc.in_progress ?? 0) + Number(c.c)
      } else if (c.status === 'cancelled') sc.cancelled = (sc.cancelled ?? 0) + Number(c.c)
      else if (c.status === 'submitted') {
        if (!c.graded) sc.completed = (sc.completed ?? 0) + Number(c.c)
        else if (c.passed) sc.pass = (sc.pass ?? 0) + Number(c.c)
        else sc.fail = (sc.fail ?? 0) + Number(c.c)
      }
    }

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: sc,
    }
  })

  const newAssessmentOptions =
    drawerKey === 'new'
      ? await ctx.db(async (tx) => {
          const [types, peopleRows] = await Promise.all([
            tx
              .select({
                id: trainingAssessmentTypes.id,
                name: trainingAssessmentTypes.name,
                description: trainingAssessmentTypes.description,
                passingScore: trainingAssessmentTypes.passingScore,
                graded: trainingAssessmentTypes.graded,
              })
              .from(trainingAssessmentTypes)
              .where(
                and(
                  eq(trainingAssessmentTypes.active, true),
                  isNull(trainingAssessmentTypes.deletedAt),
                  requestedTypeId && isUuid(requestedTypeId)
                    ? eq(trainingAssessmentTypes.id, requestedTypeId)
                    : undefined,
                ),
              )
              .orderBy(asc(trainingAssessmentTypes.name)),
            tx
              .select({
                id: people.id,
                firstName: people.firstName,
                lastName: people.lastName,
                employeeNo: people.employeeNo,
              })
              .from(people)
              .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
              .orderBy(asc(people.lastName), asc(people.firstName)),
          ])
          return { types, peopleRows }
        })
      : { types: [], peopleRows: [] }

  const sortProps = { basePath: '/training/assessments', currentParams: sp, dir: params.dir }
  const createHref = mergeHref('/training/assessments', sp, { drawer: 'new' })
  const closeHref = mergeHref('/training/assessments', sp, {
    drawer: null,
    typeId: null,
    personId: null,
    obligationId: null,
  })
  const requestedPersonId = pickString(sp.personId)
  const defaultPersonId =
    (requestedPersonId && isUuid(requestedPersonId) ? requestedPersonId : undefined) ??
    (personFilter && isUuid(personFilter) ? personFilter : undefined) ??
    ctx.personId ??
    undefined
  const complianceObligationId = pickString(sp.obligationId)

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_037a7504abbf0b')}
            description={tGenerated('m_141f91c81a0fe6')}
            actions={
              <Link href={createHref} scroll={false}>
                <Button>
                  <GeneratedValue value="New assessment" />
                </Button>
              </Link>
            }
          />
          <TrainingSubNav active="assessments" />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder={tGenerated('m_07d616cb909bf5')} />
            <form className="flex items-center gap-1 text-xs">
              {/* A GET form replaces the whole query string, so carry every
                  other active filter/sort through hidden inputs — applying a
                  date range must not clear them. */}
              <GeneratedValue
                value={(['q', 'status', 'person', 'type', 'course', 'sort', 'dir'] as const).map(
                  (key) => {
                    const value = pickString(sp[key])
                    return value ? <input key={key} type="hidden" name={key} value={value} /> : null
                  },
                )}
              />
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_15041baf9dfe8b" />
                <input
                  type="date"
                  name="dateFrom"
                  defaultValue={dateFrom ?? ''}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_02d4f83ff8f11c" />
                <input
                  type="date"
                  name="dateTo"
                  defaultValue={dateTo ?? ''}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700"
                />
              </label>
              <button
                type="submit"
                className="h-8 rounded-md border border-slate-200 px-2 text-xs hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
              >
                <GeneratedText id="m_01185cdc1c20a5" />
              </button>
            </form>
            <FilterChips
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="status"
              label={tGenerated('m_0b9da892d6faf0')}
              options={STATUS_OPTIONS.map((o) => ({
                ...o,
                count: statusCounts[o.value],
              }))}
            />
            <RemoteSearchFilter
              lookup="training-assessment-people"
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="person"
              placeholder={tGenerated('m_12e926c9216094')}
              allLabel="All people"
              searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
            />
            <RemoteSearchFilter
              lookup="training-assessment-types"
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="type"
              placeholder={tGenerated('m_169ce2294296b8')}
              allLabel="All assessment types"
              searchPlaceholder={tGenerated('m_0ce3985d801819')}
            />
            <RemoteSearchFilter
              lookup="training-assessment-courses"
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="course"
              placeholder={tGenerated('m_14fc1e0739b60e')}
              allLabel="All courses"
              searchPlaceholder={tGenerated('m_030db64e0bf790')}
            />
          </div>
        </>
      }
    >
      <GeneratedValue
        value={
          rows.length === 0 ? (
            <>
              <EmptyState
                icon={<ClipboardCheck size={32} />}
                title={tGeneratedValue(
                  params.q ? tGenerated('m_083b6ce32a6232') : tGenerated('m_06cb117a2a5c4b'),
                )}
                description={tGeneratedValue(
                  params.q ? tGenerated('m_14cb5a8694d3d8') : tGenerated('m_027150f325b223'),
                )}
                action={
                  <Link href={createHref} scroll={false}>
                    <Button>
                      <GeneratedValue value="New assessment" />
                    </Button>
                  </Link>
                }
              />
              <GeneratedValue
                value={
                  total > 0 ? (
                    <Pagination
                      basePath="/training/assessments"
                      currentParams={sp}
                      total={total}
                      page={params.page}
                      perPage={params.perPage}
                    />
                  ) : null
                }
              />
            </>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableTh
                      {...sortProps}
                      column="completed"
                      active={params.sort === 'completed'}
                    >
                      <GeneratedText id="m_0ba7a5e1b2fa32" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="person" active={params.sort === 'person'}>
                      <GeneratedText id="m_0d191facfeeb70" />
                    </SortableTh>
                    <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                      <GeneratedText id="m_1df1ba1205cf9e" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_14fc1e0739b60e" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_1922c581498469" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_0ec97074401d0f" />
                    </TableHead>
                    <SortableTh {...sortProps} column="score" active={params.sort === 'score'}>
                      <GeneratedText id="m_1469688270fa41" />
                    </SortableTh>
                    <TableHead>
                      <GeneratedText id="m_1cdf12c7dddf29" />
                    </TableHead>
                    <TableHead>
                      <GeneratedText id="m_100e41041dbe51" />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <GeneratedValue
                    value={rows.map(({ attempt, type, person, course }) => {
                      const endedAt = attempt.completedAt ?? attempt.submittedAt
                      const when = endedAt ?? attempt.startedAt
                      const duration =
                        endedAt && attempt.startedAt
                          ? Math.round(
                              (new Date(endedAt).getTime() -
                                new Date(attempt.startedAt).getTime()) /
                                60_000,
                            )
                          : null
                      return (
                        <TableRow key={attempt.id}>
                          <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-400">
                            <GeneratedValue
                              value={
                                when
                                  ? formatDateTime(new Date(when), ctx.timezone, ctx.locale)
                                  : '—'
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/people/${person.id}?tab=training`}
                              className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                            >
                              <GeneratedValue value={person.lastName} />,{' '}
                              <GeneratedValue value={person.firstName} />
                            </Link>
                            <GeneratedValue
                              value={
                                person.employeeNo ? (
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    #<GeneratedValue value={person.employeeNo} />
                                  </div>
                                ) : null
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Link
                              href={`/training/assessments/${attempt.id}`}
                              className="text-teal-700 hover:underline dark:text-teal-400"
                            >
                              <GeneratedValue value={type.name} />
                            </Link>
                          </TableCell>
                          <TableCell className="text-slate-600 dark:text-slate-400">
                            <GeneratedValue
                              value={
                                course ? (
                                  <Link
                                    href={`/training/courses/${course.id}`}
                                    className="hover:underline"
                                  >
                                    <span className="font-mono text-xs">
                                      <GeneratedValue value={course.code} />
                                    </span>
                                  </Link>
                                ) : (
                                  '—'
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-400">
                            <GeneratedValue
                              value={
                                attempt.startedAt
                                  ? formatDate(
                                      new Date(attempt.startedAt),
                                      ctx.timezone,
                                      ctx.locale,
                                    )
                                  : '—'
                              }
                            />
                          </TableCell>
                          <TableCell className="text-xs tabular-nums">
                            <GeneratedValue
                              value={
                                duration != null ? (
                                  <GeneratedText
                                    id="m_190be45ec6aa0b"
                                    values={{ value0: duration }}
                                  />
                                ) : (
                                  '—'
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="tabular-nums">
                            <GeneratedValue
                              value={
                                attempt.graded && attempt.score != null ? (
                                  <span
                                    className={
                                      attempt.status === 'submitted'
                                        ? attempt.passed
                                          ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                          : 'font-medium text-red-700 dark:text-red-400'
                                        : 'text-slate-700 dark:text-slate-300'
                                    }
                                  >
                                    <GeneratedValue value={attempt.score} />%
                                  </span>
                                ) : (
                                  '—'
                                )
                              }
                            />
                          </TableCell>
                          <TableCell className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                            <GeneratedValue
                              value={
                                attempt.graded ? (
                                  <>
                                    ≥ <GeneratedValue value={attempt.passingScore} />%
                                  </>
                                ) : (
                                  '—'
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <GeneratedValue
                              value={
                                attempt.status === 'in_progress' &&
                                attempt.reviewStatus === 'pending' ? (
                                  <Badge variant="warning">
                                    <GeneratedValue value="Awaiting review" />
                                  </Badge>
                                ) : attempt.status === 'in_progress' ? (
                                  <Badge variant="secondary">
                                    <GeneratedText id="m_1a03b06872ffd9" />
                                  </Badge>
                                ) : attempt.status === 'cancelled' ? (
                                  <Badge variant="outline">
                                    <GeneratedText id="m_1a7e1cf2be443e" />
                                  </Badge>
                                ) : !attempt.graded ? (
                                  <Badge variant="success">
                                    <GeneratedValue value="Completed" />
                                  </Badge>
                                ) : attempt.passed ? (
                                  <Badge variant="success">
                                    <GeneratedText id="m_0e4b19568a01bf" />
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive">
                                    <GeneratedText id="m_169669494a86f8" />
                                  </Badge>
                                )
                              }
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  />
                </TableBody>
              </Table>
              <Pagination
                basePath="/training/assessments"
                currentParams={sp}
                total={total}
                page={params.page}
                perPage={params.perPage}
              />
            </>
          )
        }
      />
      <UrlDrawer
        open={drawerKey === 'new'}
        closeHref={closeHref}
        title={tGeneratedValue('New assessment')}
        description={tGeneratedValue(
          'Choose the person and assessment type. The new record opens immediately.',
        )}
        size="md"
      >
        <NewTrainingAssessmentDrawer
          types={newAssessmentOptions.types}
          people={newAssessmentOptions.peopleRows.map((person) => ({
            value: person.id,
            label: `${person.lastName}, ${person.firstName}`,
            hint: person.employeeNo ?? undefined,
          }))}
          defaultPersonId={defaultPersonId}
          complianceObligationId={
            complianceObligationId && isUuid(complianceObligationId)
              ? complianceObligationId
              : undefined
          }
          startAction={startAssessmentAttempt}
        />
      </UrlDrawer>
    </ListPageLayout>
  )
}
