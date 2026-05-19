// Training dashboard — port of the legacy "Training" landing page.
//
// The legacy view crammed five filters across the top (course, assessment,
// division, group, trade, date range) and then rendered four parallel tables:
//   1. Certificates issued in the selected window.
//   2. Expired / expiring certificates.
//   3. Assessment attempts (graded quiz attempts) in the window.
//   4. Failed assessments.
//
// This page reproduces that shape on top of the new schema. Each table is
// paginated independently via the existing `parseListParams` helper using a
// table-scoped sort/page key (so we can show all four on one screen without the
// pagers fighting each other).
//
// All five filters are URL params so refresh + share + back work naturally; the
// filter strip uses native <select> elements so the page works without JS.

import Link from 'next/link'
import { Award, CalendarDays, ClipboardCheck, XCircle } from 'lucide-react'
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  PageHeader,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@beaconhs/ui'
import {
  people,
  personDivisions,
  personGroups,
  trades,
  trainingAssessmentTypes,
  trainingAssessments,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { clamp, pickString } from '@/lib/list-params'
import { ListPageLayout } from '@/components/page-layout'
import { TrainingSubNav } from './_components/training-sub-nav'

export const metadata = { title: 'Training' }
export const dynamic = 'force-dynamic'

const PER_PAGE = 10

function parsePage(value: string | string[] | undefined): number {
  const n = Number(pickString(value) ?? '1')
  return clamp(Number.isFinite(n) ? n : 1, 1, 10_000)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString()
}

function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleString()
}

export default async function TrainingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const ctx = await requireRequestContext()

  const today = new Date()
  const defaultFromDate = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000)

  const dateFrom = pickString(sp.dateFrom) || isoDate(defaultFromDate)
  const dateTo = pickString(sp.dateTo) || isoDate(today)
  const courseFilter = pickString(sp.course) || ''
  const divisionFilter = pickString(sp.division) || ''
  const groupFilter = pickString(sp.group) || ''
  const tradeFilter = pickString(sp.trade) || ''
  const assessmentTypeFilter = pickString(sp.assessmentType) || ''

  const certsPage = parsePage(sp.certsPage)
  const expiredPage = parsePage(sp.expiredPage)
  const attemptsPage = parsePage(sp.attemptsPage)
  const failedPage = parsePage(sp.failedPage)

  const {
    coursesList,
    divisionsList,
    groupsList,
    tradesList,
    assessmentTypesList,
    certificates,
    certificatesTotal,
    expired,
    expiredTotal,
    attempts,
    attemptsTotal,
    failed,
    failedTotal,
    statSummary,
  } = await ctx.db(async (tx) => {
    // ---- Reference filter options ----
    const coursesAll = await tx
      .select({ id: trainingCourses.id, code: trainingCourses.code, name: trainingCourses.name })
      .from(trainingCourses)
      .where(isNull(trainingCourses.deletedAt))
      .orderBy(asc(trainingCourses.name))
      .limit(500)

    const divisionsAll = await tx
      .select({ id: personDivisions.id, name: personDivisions.name })
      .from(personDivisions)
      .where(isNull(personDivisions.deletedAt))
      .orderBy(asc(personDivisions.name))
      .limit(500)

    const groupsAll = await tx
      .select({ id: personGroups.id, name: personGroups.name })
      .from(personGroups)
      .where(isNull(personGroups.deletedAt))
      .orderBy(asc(personGroups.name))
      .limit(500)

    const tradesAll = await tx
      .select({ id: trades.id, name: trades.name })
      .from(trades)
      .orderBy(asc(trades.name))
      .limit(500)

    const assessmentTypesAll = await tx
      .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
      .from(trainingAssessmentTypes)
      .where(isNull(trainingAssessmentTypes.deletedAt))
      .orderBy(asc(trainingAssessmentTypes.name))
      .limit(500)

    // ---- Filter helpers ----
    function peopleFilters(): SQL<unknown>[] {
      const arr: SQL<unknown>[] = []
      if (tradeFilter) arr.push(eq(people.tradeId, tradeFilter))
      if (divisionFilter) {
        arr.push(sql`${people.divisionIds} ? ${divisionFilter}`)
      }
      if (groupFilter) {
        arr.push(sql`${people.groupIds} ? ${groupFilter}`)
      }
      return arr
    }

    // ---- 1. Certificates issued in window ----
    const certFilters: SQL<unknown>[] = [
      isNull(trainingRecords.deletedAt),
      gte(trainingRecords.completedOn, dateFrom),
      lte(trainingRecords.completedOn, dateTo),
    ]
    if (courseFilter) certFilters.push(eq(trainingRecords.courseId, courseFilter))
    certFilters.push(...peopleFilters())
    const certWhere = and(...certFilters)

    const [certTot] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(certWhere)
    const certs = await tx
      .select({
        record: trainingRecords,
        person: people,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(certWhere)
      .orderBy(desc(trainingRecords.completedOn))
      .limit(PER_PAGE)
      .offset((certsPage - 1) * PER_PAGE)

    // ---- 2. Expired or expiring certificates within window ----
    const expiredFilters: SQL<unknown>[] = [
      isNull(trainingRecords.deletedAt),
      isNotNull(trainingRecords.expiresOn),
      lte(trainingRecords.expiresOn, dateTo),
    ]
    if (courseFilter) expiredFilters.push(eq(trainingRecords.courseId, courseFilter))
    expiredFilters.push(...peopleFilters())
    const expiredWhere = and(...expiredFilters)
    const [expTot] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(expiredWhere)
    const expiredRows = await tx
      .select({ record: trainingRecords, person: people, course: trainingCourses })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(expiredWhere)
      .orderBy(asc(trainingRecords.expiresOn))
      .limit(PER_PAGE)
      .offset((expiredPage - 1) * PER_PAGE)

    // ---- 3. Assessment attempts in window ----
    const attemptFilters: SQL<unknown>[] = [
      isNull(trainingAssessments.deletedAt),
    ]
    // Use completedAt when present, else startedAt for the window.
    attemptFilters.push(
      sql`coalesce(${trainingAssessments.completedAt}, ${trainingAssessments.startedAt})::date >= ${dateFrom}`,
    )
    attemptFilters.push(
      sql`coalesce(${trainingAssessments.completedAt}, ${trainingAssessments.startedAt})::date <= ${dateTo}`,
    )
    if (assessmentTypeFilter) attemptFilters.push(eq(trainingAssessments.typeId, assessmentTypeFilter))
    if (courseFilter) attemptFilters.push(eq(trainingAssessments.courseId, courseFilter))
    attemptFilters.push(...peopleFilters())
    const attemptWhere = and(...attemptFilters)
    const [attemptTot] = await tx
      .select({ c: count() })
      .from(trainingAssessments)
      .innerJoin(trainingAssessmentTypes, eq(trainingAssessmentTypes.id, trainingAssessments.typeId))
      .innerJoin(people, eq(people.id, trainingAssessments.personId))
      .where(attemptWhere)
    const attemptRows = await tx
      .select({
        attempt: trainingAssessments,
        type: trainingAssessmentTypes,
        person: people,
        course: trainingCourses,
      })
      .from(trainingAssessments)
      .innerJoin(trainingAssessmentTypes, eq(trainingAssessmentTypes.id, trainingAssessments.typeId))
      .innerJoin(people, eq(people.id, trainingAssessments.personId))
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAssessments.courseId))
      .where(attemptWhere)
      .orderBy(desc(sql`coalesce(${trainingAssessments.completedAt}, ${trainingAssessments.startedAt})`))
      .limit(PER_PAGE)
      .offset((attemptsPage - 1) * PER_PAGE)

    // ---- 4. Failed assessments only ----
    const failedFilters: SQL<unknown>[] = [
      isNull(trainingAssessments.deletedAt),
      eq(trainingAssessments.status, 'submitted'),
      eq(trainingAssessments.passed, false),
    ]
    failedFilters.push(
      sql`${trainingAssessments.completedAt}::date >= ${dateFrom}`,
    )
    failedFilters.push(
      sql`${trainingAssessments.completedAt}::date <= ${dateTo}`,
    )
    if (assessmentTypeFilter) failedFilters.push(eq(trainingAssessments.typeId, assessmentTypeFilter))
    if (courseFilter) failedFilters.push(eq(trainingAssessments.courseId, courseFilter))
    failedFilters.push(...peopleFilters())
    const failedWhere = and(...failedFilters)
    const [failTot] = await tx
      .select({ c: count() })
      .from(trainingAssessments)
      .innerJoin(trainingAssessmentTypes, eq(trainingAssessmentTypes.id, trainingAssessments.typeId))
      .innerJoin(people, eq(people.id, trainingAssessments.personId))
      .where(failedWhere)
    const failedRows = await tx
      .select({
        attempt: trainingAssessments,
        type: trainingAssessmentTypes,
        person: people,
        course: trainingCourses,
      })
      .from(trainingAssessments)
      .innerJoin(trainingAssessmentTypes, eq(trainingAssessmentTypes.id, trainingAssessments.typeId))
      .innerJoin(people, eq(people.id, trainingAssessments.personId))
      .leftJoin(trainingCourses, eq(trainingCourses.id, trainingAssessments.courseId))
      .where(failedWhere)
      .orderBy(desc(trainingAssessments.completedAt))
      .limit(PER_PAGE)
      .offset((failedPage - 1) * PER_PAGE)

    // ---- Top-of-page summary cards (unfiltered counts) ----
    const todayIso = isoDate(today)
    const [activeRecordsRow] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(isNull(trainingRecords.deletedAt))
    const [expiredOverallRow] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(
        and(
          isNull(trainingRecords.deletedAt),
          isNotNull(trainingRecords.expiresOn),
          lte(trainingRecords.expiresOn, todayIso),
        ),
      )
    const [coursesRow] = await tx
      .select({ c: count() })
      .from(trainingCourses)
      .where(isNull(trainingCourses.deletedAt))

    return {
      coursesList: coursesAll,
      divisionsList: divisionsAll,
      groupsList: groupsAll,
      tradesList: tradesAll,
      assessmentTypesList: assessmentTypesAll,
      certificates: certs,
      certificatesTotal: Number(certTot?.c ?? 0),
      expired: expiredRows,
      expiredTotal: Number(expTot?.c ?? 0),
      attempts: attemptRows,
      attemptsTotal: Number(attemptTot?.c ?? 0),
      failed: failedRows,
      failedTotal: Number(failTot?.c ?? 0),
      statSummary: {
        activeRecords: Number(activeRecordsRow?.c ?? 0),
        expiredOverall: Number(expiredOverallRow?.c ?? 0),
        coursesCount: Number(coursesRow?.c ?? 0),
      },
    }
  })

  const certsPageCount = Math.max(1, Math.ceil(certificatesTotal / PER_PAGE))
  const expiredPageCount = Math.max(1, Math.ceil(expiredTotal / PER_PAGE))
  const attemptsPageCount = Math.max(1, Math.ceil(attemptsTotal / PER_PAGE))
  const failedPageCount = Math.max(1, Math.ceil(failedTotal / PER_PAGE))

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Training"
            description="Certificates issued, expired records, assessment attempts, and failed assessments. Filter by course, division, group, trade, or assessment type."
            actions={
              <div className="flex items-center gap-2">
                <Link href="/training/records/new">
                  <Button variant="outline">Log a record</Button>
                </Link>
                <Link href="/training/courses/new">
                  <Button>New course</Button>
                </Link>
              </div>
            }
          />
          <TrainingSubNav active="records" />

          {/* Filter strip — five filters laid out as a horizontal form. The
              page rerenders with the new params on submit; no JS required. */}
          <form
            method="get"
            className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
          >
            <FilterSelect
              label="Course"
              name="course"
              value={courseFilter}
              options={coursesList.map((c) => ({
                value: c.id,
                label: `${c.code ? `${c.code} · ` : ''}${c.name}`,
              }))}
              placeholder="All courses"
            />
            <FilterSelect
              label="Assessment"
              name="assessmentType"
              value={assessmentTypeFilter}
              options={assessmentTypesList.map((t) => ({ value: t.id, label: t.name }))}
              placeholder="All assessments"
            />
            <FilterSelect
              label="Division"
              name="division"
              value={divisionFilter}
              options={divisionsList.map((d) => ({ value: d.id, label: d.name }))}
              placeholder="All divisions"
            />
            <FilterSelect
              label="Group"
              name="group"
              value={groupFilter}
              options={groupsList.map((g) => ({ value: g.id, label: g.name }))}
              placeholder="All groups"
            />
            <FilterSelect
              label="Trade"
              name="trade"
              value={tradeFilter}
              options={tradesList.map((t) => ({ value: t.id, label: t.name }))}
              placeholder="All trades"
            />
            <DateField label="Date from" name="dateFrom" value={dateFrom} />
            <DateField label="Date to" name="dateTo" value={dateTo} />
            <Button type="submit">Apply</Button>
            <Link
              href="/training"
              className="text-xs text-slate-500 underline hover:text-slate-700"
            >
              Reset
            </Link>
          </form>
        </>
      }
    >
      <div className="space-y-6">
        {/* ---- Top-line stat cards ---- */}
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            icon={<Award size={18} />}
            label="Active records"
            value={statSummary.activeRecords}
            description="Training certificates not yet deleted"
            tone="success"
          />
          <StatCard
            icon={<XCircle size={18} />}
            label="Expired overall"
            value={statSummary.expiredOverall}
            description="Past-expiry certificates that need renewal"
            tone="danger"
          />
          <StatCard
            icon={<CalendarDays size={18} />}
            label="Courses in catalogue"
            value={statSummary.coursesCount}
            description="Courses available to assign"
            tone="neutral"
          />
        </div>

        {/* ---- Section 1: Certificates issued ---- */}
        <DashboardSection
          icon={<Award size={18} className="text-emerald-700" />}
          title="Certificates issued"
          subtitle={`Records completed between ${fmtDate(dateFrom)} and ${fmtDate(dateTo)}.`}
          total={certificatesTotal}
        >
          {certificates.length === 0 ? (
            <EmptyState
              icon={<Award size={28} />}
              title="No certificates issued in this window"
              description="Widen the date range or change filters to see more."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Train date</TableHead>
                    <TableHead>Expiry date</TableHead>
                    <TableHead className="w-20">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {certificates.map(({ record, person, course }) => (
                    <TableRow key={record.id}>
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
                          href={`/training/courses/${course.id}`}
                          className="text-slate-700 hover:underline"
                        >
                          <span className="font-mono text-xs">{course.code}</span> · {course.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-slate-600 tabular-nums">
                        {fmtDate(record.completedOn)}
                      </TableCell>
                      <TableCell className="text-slate-600 tabular-nums">
                        {record.expiresOn ? (
                          <span className={expiryClass(record.expiresOn)}>
                            {fmtDate(record.expiresOn)}
                          </span>
                        ) : (
                          <span className="text-slate-400">Never</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/training/records/${record.id}`}
                          className="text-teal-700 hover:underline text-xs"
                        >
                          View →
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <SectionPager
                page={certsPage}
                pageCount={certsPageCount}
                paramKey="certsPage"
                currentParams={sp}
              />
            </>
          )}
        </DashboardSection>

        {/* ---- Section 2: Expired certificates ---- */}
        <DashboardSection
          icon={<XCircle size={18} className="text-red-700" />}
          title="Expired certificates"
          subtitle={`Records whose expiry date is on or before ${fmtDate(dateTo)}.`}
          total={expiredTotal}
        >
          {expired.length === 0 ? (
            <EmptyState
              icon={<XCircle size={28} />}
              title="No expired records"
              description="All training certificates in this filter are current."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Course</TableHead>
                    <TableHead>Train date</TableHead>
                    <TableHead>Expired</TableHead>
                    <TableHead className="w-20">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expired.map(({ record, person, course }) => {
                    const exp = record.expiresOn ? new Date(record.expiresOn) : null
                    const days = exp
                      ? Math.round((exp.getTime() - today.getTime()) / 86_400_000)
                      : null
                    return (
                      <TableRow key={record.id}>
                        <TableCell>
                          <Link
                            href={`/training/transcripts/${person.id}`}
                            className="font-medium text-slate-900 hover:underline"
                          >
                            {person.lastName}, {person.firstName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/training/courses/${course.id}`}
                            className="hover:underline"
                          >
                            <span className="font-mono text-xs">{course.code}</span> ·{' '}
                            {course.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-slate-600 tabular-nums">
                          {fmtDate(record.completedOn)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={days != null && days < 0 ? 'destructive' : 'warning'}>
                            {days != null
                              ? days < 0
                                ? `Expired ${Math.abs(days)}d ago`
                                : `${days}d remaining`
                              : 'Expired'}
                          </Badge>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {fmtDate(record.expiresOn)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/training/records/${record.id}`}
                            className="text-teal-700 hover:underline text-xs"
                          >
                            View →
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <SectionPager
                page={expiredPage}
                pageCount={expiredPageCount}
                paramKey="expiredPage"
                currentParams={sp}
              />
            </>
          )}
        </DashboardSection>

        {/* ---- Section 3: Assessment attempts ---- */}
        <DashboardSection
          icon={<ClipboardCheck size={18} className="text-teal-700" />}
          title="Assessment attempts"
          subtitle={`Graded quiz attempts between ${fmtDate(dateFrom)} and ${fmtDate(dateTo)}.`}
          total={attemptsTotal}
        >
          {attempts.length === 0 ? (
            <EmptyState
              icon={<ClipboardCheck size={28} />}
              title="No assessment attempts in window"
              description="Try widening the date range or removing the assessment-type filter."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Course / location</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Result</TableHead>
                    <TableHead className="w-20">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.map(({ attempt, type, person, course }) => {
                    const when = attempt.completedAt ?? attempt.startedAt
                    return (
                      <TableRow key={attempt.id}>
                        <TableCell>
                          <Link
                            href={`/training/transcripts/${person.id}`}
                            className="font-medium text-slate-900 hover:underline"
                          >
                            {person.lastName}, {person.firstName}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/training/assessments/${attempt.id}`}
                            className="text-slate-900 hover:underline"
                          >
                            {type.name}
                          </Link>
                          <div className="text-xs text-slate-500">
                            Pass ≥ {attempt.passingScore}%
                          </div>
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
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-slate-600 text-xs tabular-nums">
                          {fmtDateTime(when)}
                        </TableCell>
                        <TableCell>
                          {attempt.status === 'in_progress' ? (
                            <Badge variant="secondary">In progress</Badge>
                          ) : attempt.status === 'cancelled' ? (
                            <Badge variant="outline">Cancelled</Badge>
                          ) : attempt.passed ? (
                            <Badge variant="success">
                              Pass · {attempt.score ?? '—'}%
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              Fail · {attempt.score ?? '—'}%
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/training/assessments/${attempt.id}`}
                            className="text-teal-700 hover:underline text-xs"
                          >
                            View →
                          </Link>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
              <SectionPager
                page={attemptsPage}
                pageCount={attemptsPageCount}
                paramKey="attemptsPage"
                currentParams={sp}
              />
            </>
          )}
        </DashboardSection>

        {/* ---- Section 4: Failed assessments ---- */}
        <DashboardSection
          icon={<XCircle size={18} className="text-red-700" />}
          title="Failed assessments"
          subtitle="Submitted attempts that did not meet the passing score."
          total={failedTotal}
        >
          {failed.length === 0 ? (
            <EmptyState
              icon={<XCircle size={28} />}
              title="No failed assessments"
              description="Either nobody failed in this window, or there are no submitted attempts at all."
            />
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Assessment</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Failed on</TableHead>
                    <TableHead className="w-20">View</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failed.map(({ attempt, type, person, course }) => (
                    <TableRow key={attempt.id}>
                      <TableCell>
                        <Link
                          href={`/training/transcripts/${person.id}`}
                          className="font-medium text-slate-900 hover:underline"
                        >
                          {person.lastName}, {person.firstName}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/training/assessments/${attempt.id}`}
                          className="text-slate-900 hover:underline"
                        >
                          {type.name}
                        </Link>
                        {course ? (
                          <div className="text-xs text-slate-500">
                            <span className="font-mono">{course.code}</span> · {course.name}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant="destructive">
                          {attempt.score != null ? `${attempt.score}%` : '—'} / {attempt.passingScore}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 text-xs tabular-nums">
                        {fmtDateTime(attempt.completedAt)}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/training/assessments/${attempt.id}`}
                          className="text-teal-700 hover:underline text-xs"
                        >
                          Review →
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <SectionPager
                page={failedPage}
                pageCount={failedPageCount}
                paramKey="failedPage"
                currentParams={sp}
              />
            </>
          )}
        </DashboardSection>
      </div>
    </ListPageLayout>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function expiryClass(d: string | null | undefined): string {
  if (!d) return 'text-slate-400'
  const days = Math.round((new Date(d).getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'text-red-700 font-medium'
  if (days <= 30) return 'text-amber-700 font-medium'
  return 'text-slate-700'
}

function FilterSelect({
  label,
  name,
  value,
  options,
  placeholder,
}: {
  label: string
  name: string
  value: string
  options: { value: string; label: string }[]
  placeholder: string
}) {
  return (
    <label className="flex min-w-[160px] flex-1 flex-col text-xs">
      <span className="mb-1 font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <Select name={name} defaultValue={value}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </label>
  )
}

function DateField({
  label,
  name,
  value,
}: {
  label: string
  name: string
  value: string
}) {
  return (
    <label className="flex flex-col text-xs">
      <span className="mb-1 font-medium uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="date"
        name={name}
        defaultValue={value}
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
      />
    </label>
  )
}

function StatCard({
  icon,
  label,
  value,
  description,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: number
  description: string
  tone: 'success' | 'danger' | 'neutral'
}) {
  const dotClass =
    tone === 'success'
      ? 'bg-emerald-100 text-emerald-700'
      : tone === 'danger'
        ? 'bg-red-100 text-red-700'
        : 'bg-slate-100 text-slate-700'
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-3 pb-2">
        <span className={`grid h-9 w-9 place-items-center rounded-md ${dotClass}`}>{icon}</span>
        <CardTitle className="text-sm font-medium text-slate-600">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums text-slate-900">
          {value.toLocaleString()}
        </div>
        <p className="text-xs text-slate-500">{description}</p>
      </CardContent>
    </Card>
  )
}

function DashboardSection({
  icon,
  title,
  subtitle,
  total,
  children,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
  total: number
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0">{icon}</span>
            <div className="min-w-0">
              <CardTitle className="truncate">{title}</CardTitle>
              <p className="text-xs text-slate-500 truncate">{subtitle}</p>
            </div>
          </div>
          <Badge variant="secondary">{total.toLocaleString()}</Badge>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

function SectionPager({
  page,
  pageCount,
  paramKey,
  currentParams,
}: {
  page: number
  pageCount: number
  paramKey: string
  currentParams: Record<string, string | string[] | undefined>
}) {
  if (pageCount <= 1) return null
  const buildHref = (newPage: number): string => {
    const usp = new URLSearchParams()
    for (const [k, v] of Object.entries(currentParams)) {
      if (k === paramKey) continue
      if (Array.isArray(v)) {
        for (const vv of v) usp.append(k, vv)
      } else if (typeof v === 'string') {
        usp.set(k, v)
      }
    }
    usp.set(paramKey, String(newPage))
    return `/training?${usp.toString()}`
  }
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-xs">
      <span className="text-slate-500">
        Page {page} of {pageCount}
      </span>
      {page > 1 ? (
        <Link
          href={buildHref(page - 1) as any}
          className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50"
        >
          ← Prev
        </Link>
      ) : (
        <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">← Prev</span>
      )}
      {page < pageCount ? (
        <Link
          href={buildHref(page + 1) as any}
          className="rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50"
        >
          Next →
        </Link>
      ) : (
        <span className="rounded-md border border-slate-200 px-2 py-1 text-slate-400">
          Next →
        </span>
      )}
    </div>
  )
}

// Quiet the "unused" warning when only some helpers are referenced by sort
// helpers below.
export function _trainingDashboardReady() {
  return [inArray].length > 0
}
