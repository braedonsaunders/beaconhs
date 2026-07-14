// "My training" — the personal training hub:
//   1. Courses   — available courses + your progress (the learner catalog,
//                  formerly the standalone "My Learning")
//   2. Records   — every training_record you've earned
//   3. Expiring  — records expiring within 90 days
//   4. Assigned  — canonical compliance requirements you haven't completed yet
//
// All queries pivot on `people.userId = ctx.userId` -> `people.id`.

import Link from 'next/link'
import { GraduationCap } from 'lucide-react'
import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import {
  Badge,
  Button,
  Card,
  CardContent,
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
  complianceObligations,
  complianceStatus,
  people,
  trainingAssessmentTypes,
  trainingCourseModules,
  trainingCourses,
  trainingEnrollments,
  trainingRecords,
  trainingSkillTypes,
} from '@beaconhs/db/schema'
import { htmlToSnippet } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { deliveryLabel, deliveryMeta } from '@/app/(app)/training/_lib/delivery'
import { latestTrainingRecordOnly } from '@/lib/training-latest'
import { parseListParams } from '@/lib/list-params'
import { Pagination } from '@/components/pagination'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { ListPageLayout } from '@/components/page-layout'
import { TabNav, pickActiveTab } from '@/components/tab-nav'
import { resolveComplianceLink } from '@/app/(app)/compliance/_resolve-link'
import { WorkspaceNoIdentity } from '../_no-identity'

export const metadata = { title: 'My training' }
export const dynamic = 'force-dynamic'

const TABS = ['courses', 'records', 'expiring', 'assigned'] as const
type Tab = (typeof TABS)[number]

const MY_TRAINING_LIST_KEYS = {
  courses: {
    q: 'courseQ',
    sort: 'courseSort',
    dir: 'courseDir',
    page: 'coursePage',
    perPage: 'coursePerPage',
  },
  records: {
    q: 'recordQ',
    sort: 'recordSort',
    dir: 'recordDir',
    page: 'recordPage',
    perPage: 'recordPerPage',
  },
  expiring: {
    q: 'expiringQ',
    sort: 'expiringSort',
    dir: 'expiringDir',
    page: 'expiringPage',
    perPage: 'expiringPerPage',
  },
  assigned: {
    q: 'assignmentQ',
    sort: 'assignmentSort',
    dir: 'assignmentDir',
    page: 'assignmentPage',
    perPage: 'assignmentPerPage',
  },
} as const

type CourseCard = {
  id: string
  code: string
  name: string
  description: string | null
  deliveryType: string
  status: string | null
  percent: number
}

type TrainingRecordRow = {
  rec: typeof trainingRecords.$inferSelect
  course: typeof trainingCourses.$inferSelect | null
  isLatest: boolean
}

type ExpiringRecordRow = {
  rec: typeof trainingRecords.$inferSelect
  course: typeof trainingCourses.$inferSelect | null
}

type AssignmentRow = {
  status: typeof complianceStatus.$inferSelect
  obligation: typeof complianceObligations.$inferSelect
  course: typeof trainingCourses.$inferSelect | null
  assessmentType: typeof trainingAssessmentTypes.$inferSelect | null
  skillType: typeof trainingSkillTypes.$inferSelect | null
  enrollment: typeof trainingEnrollments.$inferSelect | null
}

export default async function MyTrainingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const tab: Tab = pickActiveTab(sp, TABS, 'courses')
  const listKeys = MY_TRAINING_LIST_KEYS[tab]
  const params = parseListParams(
    {
      q: sp[listKeys.q],
      sort: sp[listKeys.sort],
      dir: sp[listKeys.dir],
      page: sp[listKeys.page],
      perPage: sp[listKeys.perPage],
    },
    {
      sort: 'completedOn',
      dir: 'desc',
      perPage: 25,
      allowedSorts: ['completedOn', 'expiresOn', 'course'] as const,
    },
  )

  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(and(eq(people.userId, ctx.userId), isNull(people.deletedAt)))
      .limit(1)
    const personId = person?.id ?? null

    const base = {
      personId,
      coursesCount: 0,
      recordsCount: 0,
      expiringCount: 0,
      assignedCount: 0,
      courses: [] as CourseCard[],
      records: [] as TrainingRecordRow[],
      expiring: [] as ExpiringRecordRow[],
      assigned: [] as AssignmentRow[],
      total: 0,
    }

    if (!personId) return base

    // The learner catalog, by delivery type: self-paced courses appear once
    // they have a published curriculum (>= 1 module); online courses always
    // (they self-launch into an external link); classroom and on-the-job
    // courses only once training staff has enrolled you (they are attended /
    // evaluated, not "started"); external certificates never — those are
    // records entered by the training team.
    const hasModule = exists(
      tx
        .select({ id: trainingCourseModules.id })
        .from(trainingCourseModules)
        .where(
          and(
            eq(trainingCourseModules.courseId, trainingCourses.id),
            isNull(trainingCourseModules.deletedAt),
          ),
        ),
    )
    const hasEnrollment = exists(
      tx
        .select({ id: trainingEnrollments.id })
        .from(trainingEnrollments)
        .where(
          and(
            eq(trainingEnrollments.courseId, trainingCourses.id),
            eq(trainingEnrollments.personId, personId),
            isNull(trainingEnrollments.deletedAt),
          ),
        ),
    )
    const availableCourseWhere = and(
      isNull(trainingCourses.deletedAt),
      or(
        eq(trainingCourses.deliveryType, 'online'),
        and(eq(trainingCourses.deliveryType, 'self_paced'), hasModule),
        and(
          inArray(trainingCourses.deliveryType, ['classroom', 'on_the_job']),
          hasModule,
          hasEnrollment,
        ),
      ),
    )
    const [coursesCountRow] = await tx
      .select({ c: count() })
      .from(trainingCourses)
      .where(availableCourseWhere)
    const coursesCount = Number(coursesCountRow?.c ?? 0)

    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const ninetyDays = new Date()
    ninetyDays.setDate(ninetyDays.getDate() + 90)
    const ninetyDaysStr = ninetyDays.toISOString().slice(0, 10)

    const [recCntRow] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(and(eq(trainingRecords.personId, personId), isNull(trainingRecords.deletedAt)))
    const recordsCount = Number(recCntRow?.c ?? 0)

    const [expCntRow] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(
        and(
          eq(trainingRecords.personId, personId),
          isNull(trainingRecords.deletedAt),
          gte(trainingRecords.expiresOn, todayStr),
          lte(trainingRecords.expiresOn, ninetyDaysStr),
          // Retraining supersedes older records for the same course — only
          // the latest one can be "expiring".
          latestTrainingRecordOnly(),
        ),
      )
    const expiringCount = Number(expCntRow?.c ?? 0)

    const assignedScope = and(
      eq(complianceStatus.tenantId, ctx.tenantId),
      eq(complianceStatus.personId, personId),
      inArray(complianceStatus.status, ['pending', 'in_progress', 'overdue', 'expiring']),
      inArray(complianceObligations.sourceModule, ['training', 'cert_requirement']),
      eq(complianceObligations.status, 'active'),
      isNull(complianceObligations.deletedAt),
    ) as SQL<unknown>
    const [assignedCntRow] = await tx
      .select({ c: count() })
      .from(complianceStatus)
      .innerJoin(
        complianceObligations,
        and(
          eq(complianceObligations.tenantId, complianceStatus.tenantId),
          eq(complianceObligations.id, complianceStatus.obligationId),
        ),
      )
      .where(assignedScope)
    const assignedCount = Number(assignedCntRow?.c ?? 0)

    const counts = { ...base, coursesCount, recordsCount, expiringCount, assignedCount }

    if (tab === 'courses') {
      const search = params.q
        ? or(
            ilike(trainingCourses.name, `%${params.q}%`),
            ilike(trainingCourses.code, `%${params.q}%`),
            ilike(trainingCourses.description, `%${params.q}%`),
          )
        : undefined
      const courseWhere = and(availableCourseWhere, search)
      const [[filteredCountRow], rows] = await Promise.all([
        tx.select({ c: count() }).from(trainingCourses).where(courseWhere),
        tx
          .select({ course: trainingCourses, enrollment: trainingEnrollments })
          .from(trainingCourses)
          .leftJoin(
            trainingEnrollments,
            and(
              eq(trainingEnrollments.courseId, trainingCourses.id),
              eq(trainingEnrollments.personId, personId),
              isNull(trainingEnrollments.deletedAt),
            ),
          )
          .where(courseWhere)
          .orderBy(asc(trainingCourses.name), asc(trainingCourses.id))
          .limit(params.perPage)
          .offset((params.page - 1) * params.perPage),
      ])
      const courses: CourseCard[] = rows.map(({ course, enrollment }) => ({
        id: course.id,
        code: course.code,
        name: course.name,
        description: htmlToSnippet(course.description, 140) || null,
        deliveryType: course.deliveryType,
        status: enrollment?.status ?? null,
        percent: enrollment?.progressPercent ?? 0,
      }))
      return { ...counts, courses, total: Number(filteredCountRow?.c ?? 0) }
    }

    if (tab === 'records') {
      const search = params.q
        ? or(
            ilike(trainingCourses.name, `%${params.q}%`),
            ilike(trainingCourses.code, `%${params.q}%`),
            ilike(trainingRecords.instructor, `%${params.q}%`),
            ilike(trainingRecords.details, `%${params.q}%`),
            ilike(trainingRecords.notes, `%${params.q}%`),
          )
        : undefined
      const recordWhere = and(
        eq(trainingRecords.personId, personId),
        isNull(trainingRecords.deletedAt),
        search,
      )
      const order =
        params.sort === 'course'
          ? [params.dir === 'asc' ? asc(trainingCourses.name) : desc(trainingCourses.name)]
          : params.sort === 'expiresOn'
            ? [
                params.dir === 'asc'
                  ? asc(trainingRecords.expiresOn)
                  : desc(trainingRecords.expiresOn),
              ]
            : [
                params.dir === 'asc'
                  ? asc(trainingRecords.completedOn)
                  : desc(trainingRecords.completedOn),
              ]

      const [[filteredCountRow], records] = await Promise.all([
        tx
          .select({ c: count() })
          .from(trainingRecords)
          .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
          .where(recordWhere),
        tx
          .select({
            rec: trainingRecords,
            course: trainingCourses,
            // Full history stays visible, but rows replaced by a newer record for
            // the same course are labelled "superseded" instead of "expired".
            isLatest: latestTrainingRecordOnly().mapWith(Boolean),
          })
          .from(trainingRecords)
          .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
          .where(recordWhere)
          .orderBy(...order, desc(trainingRecords.id))
          .limit(params.perPage)
          .offset((params.page - 1) * params.perPage),
      ])
      return { ...counts, records, total: Number(filteredCountRow?.c ?? 0) }
    }
    if (tab === 'expiring') {
      const search = params.q
        ? or(
            ilike(trainingCourses.name, `%${params.q}%`),
            ilike(trainingCourses.code, `%${params.q}%`),
            ilike(trainingRecords.instructor, `%${params.q}%`),
          )
        : undefined
      const expiringWhere = and(
        eq(trainingRecords.personId, personId),
        isNull(trainingRecords.deletedAt),
        gte(trainingRecords.expiresOn, todayStr),
        lte(trainingRecords.expiresOn, ninetyDaysStr),
        latestTrainingRecordOnly(),
        search,
      )
      const [[filteredCountRow], expiring] = await Promise.all([
        tx
          .select({ c: count() })
          .from(trainingRecords)
          .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
          .where(expiringWhere),
        tx
          .select({ rec: trainingRecords, course: trainingCourses })
          .from(trainingRecords)
          .leftJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
          .where(expiringWhere)
          .orderBy(asc(trainingRecords.expiresOn), asc(trainingRecords.id))
          .limit(params.perPage)
          .offset((params.page - 1) * params.perPage),
      ])
      return { ...counts, expiring, total: Number(filteredCountRow?.c ?? 0) }
    }
    // tab === 'assigned'
    const search = params.q
      ? or(
          ilike(complianceObligations.title, `%${params.q}%`),
          ilike(complianceObligations.notes, `%${params.q}%`),
          ilike(trainingCourses.name, `%${params.q}%`),
          ilike(trainingCourses.code, `%${params.q}%`),
          ilike(trainingAssessmentTypes.name, `%${params.q}%`),
          ilike(trainingSkillTypes.name, `%${params.q}%`),
        )
      : undefined
    const assignedWhere = and(assignedScope, search)
    const [[filteredCountRow], assigned] = await Promise.all([
      tx
        .select({ c: count() })
        .from(complianceStatus)
        .innerJoin(
          complianceObligations,
          and(
            eq(complianceObligations.tenantId, complianceStatus.tenantId),
            eq(complianceObligations.id, complianceStatus.obligationId),
          ),
        )
        .leftJoin(
          trainingCourses,
          and(
            eq(trainingCourses.tenantId, complianceStatus.tenantId),
            eq(trainingCourses.id, sql<string>`${complianceObligations.targetRef}->>'courseId'`),
            isNull(trainingCourses.deletedAt),
          ),
        )
        .leftJoin(
          trainingAssessmentTypes,
          and(
            eq(trainingAssessmentTypes.tenantId, complianceStatus.tenantId),
            eq(
              trainingAssessmentTypes.id,
              sql<string>`${complianceObligations.targetRef}->>'assessmentTypeId'`,
            ),
            isNull(trainingAssessmentTypes.deletedAt),
          ),
        )
        .leftJoin(
          trainingSkillTypes,
          and(
            eq(trainingSkillTypes.tenantId, complianceStatus.tenantId),
            eq(
              trainingSkillTypes.id,
              sql<string>`${complianceObligations.targetRef}->>'skillTypeId'`,
            ),
          ),
        )
        .where(assignedWhere),
      tx
        .select({
          status: complianceStatus,
          obligation: complianceObligations,
          course: trainingCourses,
          assessmentType: trainingAssessmentTypes,
          skillType: trainingSkillTypes,
          enrollment: trainingEnrollments,
        })
        .from(complianceStatus)
        .innerJoin(
          complianceObligations,
          and(
            eq(complianceObligations.tenantId, complianceStatus.tenantId),
            eq(complianceObligations.id, complianceStatus.obligationId),
          ),
        )
        .leftJoin(
          trainingCourses,
          and(
            eq(trainingCourses.tenantId, complianceStatus.tenantId),
            eq(trainingCourses.id, sql<string>`${complianceObligations.targetRef}->>'courseId'`),
            isNull(trainingCourses.deletedAt),
          ),
        )
        .leftJoin(
          trainingAssessmentTypes,
          and(
            eq(trainingAssessmentTypes.tenantId, complianceStatus.tenantId),
            eq(
              trainingAssessmentTypes.id,
              sql<string>`${complianceObligations.targetRef}->>'assessmentTypeId'`,
            ),
            isNull(trainingAssessmentTypes.deletedAt),
          ),
        )
        .leftJoin(
          trainingSkillTypes,
          and(
            eq(trainingSkillTypes.tenantId, complianceStatus.tenantId),
            eq(
              trainingSkillTypes.id,
              sql<string>`${complianceObligations.targetRef}->>'skillTypeId'`,
            ),
          ),
        )
        .leftJoin(
          trainingEnrollments,
          and(
            eq(trainingEnrollments.tenantId, complianceStatus.tenantId),
            eq(trainingEnrollments.personId, personId),
            eq(
              trainingEnrollments.courseId,
              sql<string>`${complianceObligations.targetRef}->>'courseId'`,
            ),
            isNull(trainingEnrollments.deletedAt),
          ),
        )
        .where(assignedWhere)
        .orderBy(
          asc(complianceStatus.dueOn),
          desc(complianceStatus.computedAt),
          asc(complianceStatus.id),
        )
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
    ])
    return { ...counts, assigned, total: Number(filteredCountRow?.c ?? 0) }
  })

  if (!data.personId) {
    return (
      <ListPageLayout
        header={
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title="My training"
            description="Your courses, records and assignments."
            actions={
              <Link href="/training/records">
                <Button variant="outline">All records</Button>
              </Link>
            }
          />
        }
      >
        <WorkspaceNoIdentity
          reason={ctx.membership ? 'no-person' : 'no-membership'}
          noun="training"
        />
      </ListPageLayout>
    )
  }

  const todayStr = new Date().toISOString().slice(0, 10)
  const listPagination = (
    <Pagination
      basePath="/my/training"
      currentParams={sp}
      total={data.total}
      page={params.page}
      perPage={params.perPage}
      pageParamKey={listKeys.page}
    />
  )

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            back={{ href: '/my', label: 'Workspace' }}
            title="My training"
            description="Your courses, records, upcoming expirations, and outstanding assignments."
            actions={
              <Link href="/training/records">
                <Button variant="outline">All records</Button>
              </Link>
            }
          />
          <TabNav
            basePath="/my/training"
            currentParams={sp}
            active={tab}
            tabs={[
              { key: 'courses', label: 'Courses', count: data.coursesCount },
              { key: 'records', label: 'Records', count: data.recordsCount },
              { key: 'expiring', label: 'Expiring (90d)', count: data.expiringCount },
              { key: 'assigned', label: 'Assigned', count: data.assignedCount },
            ]}
          />
          <TableToolbar>
            <SearchInput
              placeholder={
                tab === 'courses'
                  ? 'Search courses…'
                  : tab === 'assigned'
                    ? 'Search assignments…'
                    : 'Search training records…'
              }
              paramKey={listKeys.q}
              pageParamKey={listKeys.page}
            />
          </TableToolbar>
        </>
      }
    >
      {tab === 'courses' ? (
        data.courses.length === 0 ? (
          <>
            <EmptyState
              icon={<GraduationCap size={32} />}
              title={params.q ? 'No courses match your search' : 'No courses available'}
              description={
                params.q
                  ? 'Try a different course name or code.'
                  : 'Courses with published content appear here.'
              }
            />
            {data.total > 0 ? listPagination : null}
          </>
        ) : (
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {data.courses.map((c) => {
                const selfLaunch = deliveryMeta(c.deliveryType).selfLaunch
                const label =
                  c.status === 'completed'
                    ? 'Review'
                    : c.status
                      ? `Continue · ${c.percent}%`
                      : selfLaunch
                        ? 'Start'
                        : 'View course'
                return (
                  <Card
                    key={c.id}
                    className="group flex h-full flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    <CardContent className="flex flex-1 flex-col gap-3 py-5">
                      <div className="flex items-start justify-between gap-2">
                        <Badge variant="outline" className="font-normal">
                          {deliveryLabel(c.deliveryType)}
                        </Badge>
                        {c.status === 'completed' ? (
                          <Badge variant="success">Completed</Badge>
                        ) : c.status ? (
                          <Badge variant="secondary">In progress</Badge>
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <h3 className="line-clamp-2 font-semibold text-slate-900 dark:text-slate-100">
                          {c.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {c.code}
                        </p>
                      </div>
                      <p className="line-clamp-2 min-h-[2.5rem] text-sm text-slate-600 dark:text-slate-400">
                        {c.description ?? ''}
                      </p>
                      {c.status ? (
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                          <div
                            className="h-full rounded-full bg-teal-500"
                            style={{ width: `${c.percent}%` }}
                          />
                        </div>
                      ) : null}
                      <div className="mt-auto pt-1">
                        <Link href={`/training/learn/${c.id}`}>
                          <Button
                            variant={c.status === 'completed' ? 'outline' : 'default'}
                            className="w-full"
                          >
                            {label}
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
            {listPagination}
          </div>
        )
      ) : null}

      {tab === 'records' ? (
        data.records.length === 0 ? (
          <>
            <EmptyState
              icon={<GraduationCap size={32} />}
              title={params.q ? 'No records match your search' : 'No training records'}
              description={
                params.q
                  ? 'Try a different course, instructor, or note.'
                  : 'Records appear here once an instructor or evaluator signs you off.'
              }
            />
            {data.total > 0 ? listPagination : null}
          </>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Grade</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.records.map(({ rec, course, isLatest }) => {
                  const superseded = !isLatest
                  const expiringSoon =
                    !superseded &&
                    rec.expiresOn &&
                    rec.expiresOn >= todayStr &&
                    rec.expiresOn <=
                      (() => {
                        const d = new Date()
                        d.setDate(d.getDate() + 90)
                        return d.toISOString().slice(0, 10)
                      })()
                  const expired = !superseded && rec.expiresOn && rec.expiresOn < todayStr
                  return (
                    <TableRow key={rec.id}>
                      <TableCell>
                        <div className="font-medium">{course?.name ?? '—'}</div>
                        {course?.code ? (
                          <div className="text-xs text-slate-500">{course.code}</div>
                        ) : null}
                      </TableCell>
                      <TableCell>{rec.completedOn}</TableCell>
                      <TableCell>
                        {rec.expiresOn ? (
                          <span
                            className={
                              expired
                                ? 'font-medium text-red-700 dark:text-red-400'
                                : expiringSoon
                                  ? 'font-medium text-amber-700 dark:text-amber-400'
                                  : ''
                            }
                          >
                            {rec.expiresOn}
                            {expired
                              ? ' (expired)'
                              : expiringSoon
                                ? ' (soon)'
                                : superseded
                                  ? ' (superseded)'
                                  : ''}
                          </span>
                        ) : superseded ? (
                          <span className="text-slate-500">Superseded</span>
                        ) : (
                          <span className="text-slate-500">No expiry</span>
                        )}
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {rec.source.replace('_', ' ')}
                      </TableCell>
                      <TableCell>
                        {rec.grade != null ? (
                          <Badge variant={rec.grade >= 80 ? 'success' : 'warning'}>
                            {rec.grade}%
                          </Badge>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {listPagination}
          </>
        )
      ) : null}

      {tab === 'expiring' ? (
        data.expiring.length === 0 ? (
          <>
            <EmptyState
              icon={<GraduationCap size={32} />}
              title={
                params.q
                  ? 'No expiring records match your search'
                  : 'Nothing expiring in the next 90 days'
              }
              description={
                params.q
                  ? 'Try a different course or instructor.'
                  : 'All certifications are valid for at least the next 90 days.'
              }
            />
            {data.total > 0 ? listPagination : null}
          </>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Course</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Days left</TableHead>
                  <TableHead>Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.expiring.map(({ rec, course }) => {
                  const daysLeft = rec.expiresOn
                    ? Math.ceil(
                        (new Date(rec.expiresOn).getTime() - new Date().getTime()) /
                          (1000 * 60 * 60 * 24),
                      )
                    : null
                  return (
                    <TableRow key={rec.id}>
                      <TableCell>
                        <div className="font-medium">{course?.name ?? '—'}</div>
                      </TableCell>
                      <TableCell>{rec.expiresOn}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            daysLeft != null && daysLeft <= 14
                              ? 'destructive'
                              : daysLeft != null && daysLeft <= 30
                                ? 'warning'
                                : 'secondary'
                          }
                        >
                          {daysLeft ?? '—'}d
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {rec.completedOn}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {listPagination}
          </>
        )
      ) : null}

      {tab === 'assigned' ? (
        data.assigned.length === 0 ? (
          <>
            <EmptyState
              icon={<GraduationCap size={32} />}
              title={params.q ? 'No assignments match your search' : 'No outstanding assignments'}
              description={
                params.q
                  ? 'Try a different assignment or course name.'
                  : 'Assigned courses and assessments appear here until completed.'
              }
            />
            {data.total > 0 ? listPagination : null}
          </>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Assignment</TableHead>
                  <TableHead>Course / item</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.assigned.map(
                  ({ status, obligation, course, assessmentType, skillType, enrollment }) => {
                    const overdue = status.status === 'overdue'
                    const link = resolveComplianceLink(
                      obligation.sourceModule,
                      obligation.targetRef,
                      {
                        personId: data.personId,
                        obligationId: obligation.id,
                      },
                    )
                    const itemName =
                      course?.name ??
                      assessmentType?.name ??
                      skillType?.name ??
                      (obligation.sourceModule === 'cert_requirement'
                        ? 'Certification requirement'
                        : 'Training requirement')
                    return (
                      <TableRow key={status.id}>
                        <TableCell>
                          <div className="font-medium">{obligation.title}</div>
                          {obligation.notes ? (
                            <div className="text-xs text-slate-500">{obligation.notes}</div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div>{itemName}</div>
                          {enrollment ? (
                            <div className="text-xs text-slate-500">
                              Course {enrollment.status.replace('_', ' ')}
                              {enrollment.status === 'in_progress'
                                ? ` · ${enrollment.progressPercent}%`
                                : ''}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <span
                            className={overdue ? 'font-medium text-red-700 dark:text-red-400' : ''}
                          >
                            {status.dueOn ?? '—'}
                            {overdue ? ' (overdue)' : ''}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              status.status === 'overdue'
                                ? 'destructive'
                                : status.status === 'completed'
                                  ? 'success'
                                  : 'warning'
                            }
                          >
                            {status.status.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {link ? (
                            <Link href={link.href as never} prefetch={link.prefetch}>
                              <Button size="sm" variant="outline">
                                Open
                              </Button>
                            </Link>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  },
                )}
              </TableBody>
            </Table>
            {listPagination}
          </>
        )
      ) : null}
    </ListPageLayout>
  )
}
