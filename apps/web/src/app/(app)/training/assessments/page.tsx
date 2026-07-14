import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
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
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { SearchInput } from '@/components/search-input'
import { RemoteSearchFilter } from '@/components/remote-search-select'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../_components/training-sub-nav'

export const metadata = { title: 'Assessments' }
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
  { value: 'pass', label: 'Pass' },
  { value: 'fail', label: 'Fail' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default async function AssessmentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
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
    } else if (statusFilter === 'cancelled') {
      filters.push(eq(trainingAssessments.status, 'cancelled'))
    } else if (statusFilter === 'pass') {
      filters.push(eq(trainingAssessments.status, 'submitted'))
      filters.push(eq(trainingAssessments.passed, true))
    } else if (statusFilter === 'fail') {
      filters.push(eq(trainingAssessments.status, 'submitted'))
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
        passed: trainingAssessments.passed,
        c: count(),
      })
      .from(trainingAssessments)
      .where(and(isNull(trainingAssessments.deletedAt), vis))
      .groupBy(trainingAssessments.status, trainingAssessments.passed)

    const sc: Record<string, number> = {
      all: 0,
      in_progress: 0,
      pass: 0,
      fail: 0,
      cancelled: 0,
    }
    for (const c of counts) {
      sc.all = (sc.all ?? 0) + Number(c.c)
      if (c.status === 'in_progress') sc.in_progress = (sc.in_progress ?? 0) + Number(c.c)
      else if (c.status === 'cancelled') sc.cancelled = (sc.cancelled ?? 0) + Number(c.c)
      else if (c.status === 'submitted') {
        if (c.passed) sc.pass = (sc.pass ?? 0) + Number(c.c)
        else sc.fail = (sc.fail ?? 0) + Number(c.c)
      }
    }

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      statusCounts: sc,
    }
  })

  const sortProps = { basePath: '/training/assessments', currentParams: sp, dir: params.dir }

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Assessments"
            description="Every assessment attempt. Filter by person, type, course, or pass/fail."
            actions={
              <div className="flex items-center gap-2">
                <Link
                  href="/training/assessments/types"
                  className="text-sm text-teal-700 hover:underline dark:text-teal-400"
                >
                  Manage types →
                </Link>
                <Link href="/training/assessments/new">
                  <Button>New attempt</Button>
                </Link>
              </div>
            }
          />
          <TrainingSubNav active="assessments" />
          <div className="flex flex-wrap items-center gap-3">
            <SearchInput placeholder="Search person, assessment, or course…" />
            <form className="flex items-center gap-1 text-xs">
              {/* A GET form replaces the whole query string, so carry every
                  other active filter/sort through hidden inputs — applying a
                  date range must not clear them. */}
              {(['q', 'status', 'person', 'type', 'course', 'sort', 'dir'] as const).map((key) => {
                const value = pickString(sp[key])
                return value ? <input key={key} type="hidden" name={key} value={value} /> : null
              })}
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                Completed from
                <input
                  type="date"
                  name="dateFrom"
                  defaultValue={dateFrom ?? ''}
                  className="h-8 rounded-md border border-slate-300 px-2 text-xs dark:border-slate-700"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
                to
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
                Apply
              </button>
            </form>
            <FilterChips
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="status"
              label="Status"
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
              placeholder="Person"
              allLabel="All people"
              searchPlaceholder="Search people…"
            />
            <RemoteSearchFilter
              lookup="training-assessment-types"
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="type"
              placeholder="Assessment type"
              allLabel="All assessment types"
              searchPlaceholder="Search assessment types…"
            />
            <RemoteSearchFilter
              lookup="training-assessment-courses"
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="course"
              placeholder="Course"
              allLabel="All courses"
              searchPlaceholder="Search courses…"
            />
          </div>
        </>
      }
    >
      {rows.length === 0 ? (
        <>
          <EmptyState
            icon={<ClipboardCheck size={32} />}
            title={params.q ? 'No assessment attempts match your search' : 'No assessment attempts'}
            description={
              params.q
                ? 'Clear the search to see other assessment attempts.'
                : 'Start an attempt to grade a candidate against an assessment type.'
            }
            action={
              <Link href="/training/assessments/new">
                <Button>Start an attempt</Button>
              </Link>
            }
          />
          {total > 0 ? (
            <Pagination
              basePath="/training/assessments"
              currentParams={sp}
              total={total}
              page={params.page}
              perPage={params.perPage}
            />
          ) : null}
        </>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <SortableTh {...sortProps} column="completed" active={params.sort === 'completed'}>
                  Completed
                </SortableTh>
                <SortableTh {...sortProps} column="person" active={params.sort === 'person'}>
                  Employee
                </SortableTh>
                <SortableTh {...sortProps} column="type" active={params.sort === 'type'}>
                  Assessment
                </SortableTh>
                <TableHead>Course</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <SortableTh {...sortProps} column="score" active={params.sort === 'score'}>
                  Score
                </SortableTh>
                <TableHead>Passing</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ attempt, type, person, course }) => {
                const when = attempt.completedAt ?? attempt.startedAt
                const duration =
                  attempt.completedAt && attempt.startedAt
                    ? Math.round(
                        (new Date(attempt.completedAt).getTime() -
                          new Date(attempt.startedAt).getTime()) /
                          60_000,
                      )
                    : null
                return (
                  <TableRow key={attempt.id}>
                    <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-400">
                      {when ? formatDateTime(new Date(when), ctx.timezone, ctx.locale) : '—'}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/people/${person.id}?tab=training`}
                        className="font-medium text-slate-900 hover:underline dark:text-slate-100"
                      >
                        {person.lastName}, {person.firstName}
                      </Link>
                      {person.employeeNo ? (
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          #{person.employeeNo}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/training/assessments/${attempt.id}`}
                        className="text-teal-700 hover:underline dark:text-teal-400"
                      >
                        {type.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">
                      {course ? (
                        <Link href={`/training/courses/${course.id}`} className="hover:underline">
                          <span className="font-mono text-xs">{course.code}</span>
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 tabular-nums dark:text-slate-400">
                      {attempt.startedAt
                        ? formatDate(new Date(attempt.startedAt), ctx.timezone, ctx.locale)
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {duration != null ? `${duration} min` : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {attempt.score != null ? (
                        <span
                          className={
                            attempt.status === 'submitted'
                              ? attempt.passed
                                ? 'font-medium text-emerald-700 dark:text-emerald-400'
                                : 'font-medium text-red-700 dark:text-red-400'
                              : 'text-slate-700 dark:text-slate-300'
                          }
                        >
                          {attempt.score}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums dark:text-slate-400">
                      ≥ {attempt.passingScore}%
                    </TableCell>
                    <TableCell>
                      {attempt.status === 'in_progress' ? (
                        <Badge variant="secondary">In progress</Badge>
                      ) : attempt.status === 'cancelled' ? (
                        <Badge variant="outline">Cancelled</Badge>
                      ) : attempt.passed ? (
                        <Badge variant="success">Pass</Badge>
                      ) : (
                        <Badge variant="destructive">Fail</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
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
      )}
    </ListPageLayout>
  )
}
