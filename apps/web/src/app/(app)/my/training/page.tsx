import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_1eac86f811af44') }
}
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
  const tGeneratedValue = await getGeneratedValueTranslations()
  const tGenerated = await getGeneratedTranslations()
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
            title={tGenerated('m_1eac86f811af44')}
            description={tGenerated('m_0fb389e240dd68')}
            actions={
              <Link href="/training/records">
                <Button variant="outline">
                  <GeneratedText id="m_1ed29908ee4a45" />
                </Button>
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
            title={tGenerated('m_1eac86f811af44')}
            description={tGenerated('m_146848d60c1c35')}
            actions={
              <Link href="/training/records">
                <Button variant="outline">
                  <GeneratedText id="m_1ed29908ee4a45" />
                </Button>
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
              placeholder={tGeneratedValue(
                tab === 'courses'
                  ? tGenerated('m_030db64e0bf790')
                  : tab === 'assigned'
                    ? tGenerated('m_14b5a0caf0bc45')
                    : tGenerated('m_03672d284068a4'),
              )}
              paramKey={listKeys.q}
              pageParamKey={listKeys.page}
            />
          </TableToolbar>
        </>
      }
    >
      <GeneratedValue
        value={
          tab === 'courses' ? (
            data.courses.length === 0 ? (
              <>
                <EmptyState
                  icon={<GraduationCap size={32} />}
                  title={tGeneratedValue(
                    params.q ? tGenerated('m_1f304eb9d92e71') : tGenerated('m_10c1c62fcdabc0'),
                  )}
                  description={tGeneratedValue(
                    params.q ? tGenerated('m_0c8d85575a79a4') : tGenerated('m_081f16a7150d52'),
                  )}
                />
                <GeneratedValue value={data.total > 0 ? listPagination : null} />
              </>
            ) : (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <GeneratedValue
                    value={data.courses.map((c) => {
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
                                <GeneratedValue value={deliveryLabel(c.deliveryType)} />
                              </Badge>
                              <GeneratedValue
                                value={
                                  c.status === 'completed' ? (
                                    <Badge variant="success">
                                      <GeneratedText id="m_0ba7a5e1b2fa32" />
                                    </Badge>
                                  ) : c.status ? (
                                    <Badge variant="secondary">
                                      <GeneratedText id="m_1a03b06872ffd9" />
                                    </Badge>
                                  ) : null
                                }
                              />
                            </div>
                            <div className="min-w-0">
                              <h3 className="line-clamp-2 font-semibold text-slate-900 dark:text-slate-100">
                                <GeneratedValue value={c.name} />
                              </h3>
                              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                                <GeneratedValue value={c.code} />
                              </p>
                            </div>
                            <p className="line-clamp-2 min-h-[2.5rem] text-sm text-slate-600 dark:text-slate-400">
                              <GeneratedValue value={c.description ?? ''} />
                            </p>
                            <GeneratedValue
                              value={
                                c.status ? (
                                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                    <div
                                      className="h-full rounded-full bg-teal-500"
                                      style={{ width: `${c.percent}%` }}
                                    />
                                  </div>
                                ) : null
                              }
                            />
                            <div className="mt-auto pt-1">
                              <Link href={`/training/learn/${c.id}`}>
                                <Button
                                  variant={c.status === 'completed' ? 'outline' : 'default'}
                                  className="w-full"
                                >
                                  <GeneratedValue value={label} />
                                </Button>
                              </Link>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  />
                </div>
                <GeneratedValue value={listPagination} />
              </div>
            )
          ) : null
        }
      />

      <GeneratedValue
        value={
          tab === 'records' ? (
            data.records.length === 0 ? (
              <>
                <EmptyState
                  icon={<GraduationCap size={32} />}
                  title={tGeneratedValue(
                    params.q ? tGenerated('m_0a338a2c68c78d') : tGenerated('m_049950ab11f977'),
                  )}
                  description={tGeneratedValue(
                    params.q ? tGenerated('m_019fbdff7df7fb') : tGenerated('m_037ba3d100e713'),
                  )}
                />
                <GeneratedValue value={data.total > 0 ? listPagination : null} />
              </>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <GeneratedText id="m_14fc1e0739b60e" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_0ba7a5e1b2fa32" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_14f3858b0a9ad6" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_1d05fa7a091a9b" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_0d49c43e2afdff" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={data.records.map(({ rec, course, isLatest }) => {
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
                              <div className="font-medium">
                                <GeneratedValue value={course?.name ?? '—'} />
                              </div>
                              <GeneratedValue
                                value={
                                  course?.code ? (
                                    <div className="text-xs text-slate-500">
                                      <GeneratedValue value={course.code} />
                                    </div>
                                  ) : null
                                }
                              />
                            </TableCell>
                            <TableCell>
                              <GeneratedValue value={rec.completedOn} />
                            </TableCell>
                            <TableCell>
                              <GeneratedValue
                                value={
                                  rec.expiresOn ? (
                                    <span
                                      className={
                                        expired
                                          ? 'font-medium text-red-700 dark:text-red-400'
                                          : expiringSoon
                                            ? 'font-medium text-amber-700 dark:text-amber-400'
                                            : ''
                                      }
                                    >
                                      <GeneratedValue value={rec.expiresOn} />
                                      <GeneratedValue
                                        value={
                                          expired ? (
                                            <GeneratedText id="m_1626f92cde00e1" />
                                          ) : expiringSoon ? (
                                            <GeneratedText id="m_01656be20ac77f" />
                                          ) : superseded ? (
                                            <GeneratedText id="m_130614a9ba074e" />
                                          ) : (
                                            ''
                                          )
                                        }
                                      />
                                    </span>
                                  ) : superseded ? (
                                    <span className="text-slate-500">
                                      <GeneratedText id="m_1c93f6d8831de6" />
                                    </span>
                                  ) : (
                                    <span className="text-slate-500">
                                      <GeneratedText id="m_1bbc44c1ce26a7" />
                                    </span>
                                  )
                                }
                              />
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              <GeneratedValue value={rec.source.replace('_', ' ')} />
                            </TableCell>
                            <TableCell>
                              <GeneratedValue
                                value={
                                  rec.grade != null ? (
                                    <Badge variant={rec.grade >= 80 ? 'success' : 'warning'}>
                                      <GeneratedValue value={rec.grade} />%
                                    </Badge>
                                  ) : (
                                    <span className="text-slate-400">—</span>
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
                <GeneratedValue value={listPagination} />
              </>
            )
          ) : null
        }
      />

      <GeneratedValue
        value={
          tab === 'expiring' ? (
            data.expiring.length === 0 ? (
              <>
                <EmptyState
                  icon={<GraduationCap size={32} />}
                  title={tGeneratedValue(
                    params.q ? tGenerated('m_1b5bbcfae1fbbb') : tGenerated('m_0d2ce01afea49b'),
                  )}
                  description={tGeneratedValue(
                    params.q ? tGenerated('m_099c0ee7f26933') : tGenerated('m_1cbe7147278d67'),
                  )}
                />
                <GeneratedValue value={data.total > 0 ? listPagination : null} />
              </>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <GeneratedText id="m_14fc1e0739b60e" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_14f3858b0a9ad6" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_10b7e0099cb7e3" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_0ba7a5e1b2fa32" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={data.expiring.map(({ rec, course }) => {
                        const daysLeft = rec.expiresOn
                          ? Math.ceil(
                              (new Date(rec.expiresOn).getTime() - new Date().getTime()) /
                                (1000 * 60 * 60 * 24),
                            )
                          : null
                        return (
                          <TableRow key={rec.id}>
                            <TableCell>
                              <div className="font-medium">
                                <GeneratedValue value={course?.name ?? '—'} />
                              </div>
                            </TableCell>
                            <TableCell>
                              <GeneratedValue value={rec.expiresOn} />
                            </TableCell>
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
                                <GeneratedValue value={daysLeft ?? '—'} />
                                <GeneratedText id="m_113dda91012a7a" />
                              </Badge>
                            </TableCell>
                            <TableCell className="text-slate-600 dark:text-slate-400">
                              <GeneratedValue value={rec.completedOn} />
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    />
                  </TableBody>
                </Table>
                <GeneratedValue value={listPagination} />
              </>
            )
          ) : null
        }
      />

      <GeneratedValue
        value={
          tab === 'assigned' ? (
            data.assigned.length === 0 ? (
              <>
                <EmptyState
                  icon={<GraduationCap size={32} />}
                  title={tGeneratedValue(
                    params.q ? tGenerated('m_0dc15f158287f4') : tGenerated('m_16b64eb23f2809'),
                  )}
                  description={tGeneratedValue(
                    params.q ? tGenerated('m_19c8c12a86c1fd') : tGenerated('m_09eb549810bad5'),
                  )}
                />
                <GeneratedValue value={data.total > 0 ? listPagination : null} />
              </>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <GeneratedText id="m_1ce516f2203741" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_009033f0e63eac" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_0c2eb92551e08b" />
                      </TableHead>
                      <TableHead>
                        <GeneratedText id="m_0b9da892d6faf0" />
                      </TableHead>
                      <TableHead className="text-right">
                        <GeneratedText id="m_0bad495a7046e9" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GeneratedValue
                      value={data.assigned.map(
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
                                <div className="font-medium">
                                  <GeneratedValue value={obligation.title} />
                                </div>
                                <GeneratedValue
                                  value={
                                    obligation.notes ? (
                                      <div className="text-xs text-slate-500">
                                        <GeneratedValue value={obligation.notes} />
                                      </div>
                                    ) : null
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <div>
                                  <GeneratedValue value={itemName} />
                                </div>
                                <GeneratedValue
                                  value={
                                    enrollment ? (
                                      <div className="text-xs text-slate-500">
                                        <GeneratedText id="m_14fc1e0739b60e" />{' '}
                                        <GeneratedValue
                                          value={enrollment.status.replace('_', ' ')}
                                        />
                                        <GeneratedValue
                                          value={
                                            enrollment.status === 'in_progress'
                                              ? ` · ${enrollment.progressPercent}%`
                                              : ''
                                          }
                                        />
                                      </div>
                                    ) : null
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <span
                                  className={
                                    overdue ? 'font-medium text-red-700 dark:text-red-400' : ''
                                  }
                                >
                                  <GeneratedValue value={status.dueOn ?? '—'} />
                                  <GeneratedValue
                                    value={overdue ? <GeneratedText id="m_0edba4030e6f71" /> : ''}
                                  />
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
                                  <GeneratedValue value={status.status.replace('_', ' ')} />
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <GeneratedValue
                                  value={
                                    link ? (
                                      <Link href={link.href as never} prefetch={link.prefetch}>
                                        <Button size="sm" variant="outline">
                                          <GeneratedText id="m_107ab58c3c38bc" />
                                        </Button>
                                      </Link>
                                    ) : (
                                      <span className="text-slate-400">—</span>
                                    )
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          )
                        },
                      )}
                    />
                  </TableBody>
                </Table>
                <GeneratedValue value={listPagination} />
              </>
            )
          ) : null
        }
      />
    </ListPageLayout>
  )
}
