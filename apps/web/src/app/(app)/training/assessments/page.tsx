import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
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
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { SortableTh } from '@/components/sortable-th'
import { Pagination } from '@/components/pagination'
import { FilterChips } from '@/components/filter-bar'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from '../_components/training-sub-nav'

export const metadata = { title: 'Assessments' }
export const dynamic = 'force-dynamic'

const SORTS = ['completed', 'person', 'type', 'score'] as const

const STATUS_OPTIONS = [
  { value: 'all', label: 'All' },
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
  const ctx = await requireRequestContext()

  const { rows, total, types, statusCounts, peopleList, coursesList } = await ctx.db(async (tx) => {
    const filters: SQL<unknown>[] = []
    filters.push(isNull(trainingAssessments.deletedAt))
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
    if (personFilter) filters.push(eq(trainingAssessments.personId, personFilter))
    if (typeFilter) filters.push(eq(trainingAssessments.typeId, typeFilter))
    if (courseFilter) filters.push(eq(trainingAssessments.courseId, courseFilter))
    if (dateFromRaw) {
      filters.push(
        sql`coalesce(${trainingAssessments.completedAt}, ${trainingAssessments.startedAt})::date >= ${dateFromRaw}`,
      )
    }
    if (dateToRaw) {
      filters.push(
        sql`coalesce(${trainingAssessments.completedAt}, ${trainingAssessments.startedAt})::date <= ${dateToRaw}`,
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
      .orderBy(...orderBy)
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)

    const typesAll = await tx
      .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
      .from(trainingAssessmentTypes)
      .where(isNull(trainingAssessmentTypes.deletedAt))
      .orderBy(asc(trainingAssessmentTypes.name))

    const peopleAll = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))

    const coursesAll = await tx
      .select({ id: trainingCourses.id, name: trainingCourses.name, code: trainingCourses.code })
      .from(trainingCourses)
      .orderBy(asc(trainingCourses.name))

    const counts = await tx
      .select({
        status: trainingAssessments.status,
        passed: trainingAssessments.passed,
        c: count(),
      })
      .from(trainingAssessments)
      .where(isNull(trainingAssessments.deletedAt))
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
      if (c.status === 'in_progress')
        sc.in_progress = (sc.in_progress ?? 0) + Number(c.c)
      else if (c.status === 'cancelled')
        sc.cancelled = (sc.cancelled ?? 0) + Number(c.c)
      else if (c.status === 'submitted') {
        if (c.passed) sc.pass = (sc.pass ?? 0) + Number(c.c)
        else sc.fail = (sc.fail ?? 0) + Number(c.c)
      }
    }

    return {
      rows: data,
      total: Number(tot?.c ?? 0),
      types: typesAll,
      peopleList: peopleAll,
      coursesList: coursesAll,
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
                  className="text-sm text-teal-700 hover:underline"
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
            <form className="flex items-center gap-1 text-xs">
              <label className="flex items-center gap-1 text-slate-500">
                Completed from
                <input
                  type="date"
                  name="dateFrom"
                  defaultValue={dateFromRaw ?? ''}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <label className="flex items-center gap-1 text-slate-500">
                to
                <input
                  type="date"
                  name="dateTo"
                  defaultValue={dateToRaw ?? ''}
                  className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                />
              </label>
              <button
                type="submit"
                className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
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
          </div>
          {peopleList.length > 0 ? (
            <FilterChips
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="person"
              label="Person"
              options={peopleList.slice(0, 12).map((p) => ({
                value: p.id,
                label: `${p.firstName} ${p.lastName}`,
              }))}
            />
          ) : null}
          {types.length > 0 ? (
            <FilterChips
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="type"
              label="Assessment type"
              options={types.slice(0, 12).map((t) => ({ value: t.id, label: t.name }))}
            />
          ) : null}
          {coursesList.length > 0 ? (
            <FilterChips
              basePath="/training/assessments"
              currentParams={sp}
              paramKey="course"
              label="Course"
              options={coursesList.slice(0, 12).map((c) => ({ value: c.id, label: c.code }))}
            />
          ) : null}
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck size={32} />}
          title="No assessment attempts yet"
          description="Start one to grade someone on an assessment type."
          action={
            <Link href="/training/assessments/new">
              <Button>Start an attempt</Button>
            </Link>
          }
        />
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
                    <TableCell className="text-slate-600 text-xs tabular-nums">
                      {when ? new Date(when).toLocaleString() : '—'}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/training/transcripts/${person.id}`}
                        className="font-medium text-slate-900 hover:underline"
                      >
                        {person.lastName}, {person.firstName}
                      </Link>
                      {person.employeeNo ? (
                        <div className="text-xs text-slate-500">#{person.employeeNo}</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/training/assessments/${attempt.id}`}
                        className="text-teal-700 hover:underline"
                      >
                        {type.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {course ? (
                        <Link
                          href={`/training/courses/${course.id}`}
                          className="hover:underline"
                        >
                          <span className="font-mono text-xs">{course.code}</span>
                        </Link>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-slate-600 text-xs tabular-nums">
                      {attempt.startedAt
                        ? new Date(attempt.startedAt).toLocaleDateString()
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
                                ? 'text-emerald-700 font-medium'
                                : 'text-red-700 font-medium'
                              : 'text-slate-700'
                          }
                        >
                          {attempt.score}%
                        </span>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 tabular-nums">
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
