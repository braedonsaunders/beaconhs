import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
import { getGeneratedTranslations } from '@/i18n/generated.server'
import { notFound } from 'next/navigation'
import { and, asc, count, eq, ilike, inArray, isNull, or } from 'drizzle-orm'
import { Button, DetailHeader, EmptyState } from '@beaconhs/ui'
import { UserCheck, UserPlus } from 'lucide-react'
import {
  people,
  tenantUsers,
  trainingCourses,
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { DetailPageLayout } from '@/components/page-layout'
import { Pagination } from '@/components/pagination'
import { RemoteSelectField } from '@/components/remote-search-select'
import { SearchInput } from '@/components/search-input'
import { TableToolbar } from '@/components/table-toolbar'
import { isUuid, parseListParams } from '@/lib/list-params'
import { enrollLearner } from './_actions'
import { EvaluationsGrid, type EvalLesson, type EvalRow } from './_evaluate'

export const dynamic = 'force-dynamic'
const SORTS = ['person'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { id } = await params
  return { title: tGenerated('m_0dcf71699d2da6', { value0: id.slice(0, 8) }) }
}

export default async function CourseEvaluationsPage({
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
  const listParams = parseListParams(sp, {
    sort: 'person',
    dir: 'asc',
    perPage: 25,
    allowedSorts: SORTS,
  })
  const ctx = await requireModuleManage('training')

  const data = await ctx.db(async (tx) => {
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, id))
      .limit(1)
    if (!course) return null

    const practicals = await tx
      .select()
      .from(trainingLessons)
      .where(
        and(
          eq(trainingLessons.courseId, id),
          eq(trainingLessons.kind, 'practical'),
          isNull(trainingLessons.deletedAt),
        ),
      )
      .orderBy(asc(trainingLessons.sortOrder))

    const enrollmentBase = and(
      eq(trainingEnrollments.courseId, id),
      isNull(trainingEnrollments.deletedAt),
    )
    const enrollmentSearch = listParams.q
      ? or(
          ilike(people.firstName, `%${listParams.q}%`),
          ilike(people.lastName, `%${listParams.q}%`),
          ilike(people.employeeNo, `%${listParams.q}%`),
        )
      : undefined
    const enrollmentWhere = and(enrollmentBase, enrollmentSearch)
    const [[enrollmentCountRow], [filteredEnrollmentCountRow], enrollments] = await Promise.all([
      tx.select({ c: count() }).from(trainingEnrollments).where(enrollmentBase),
      tx
        .select({ c: count() })
        .from(trainingEnrollments)
        .innerJoin(people, eq(people.id, trainingEnrollments.personId))
        .where(enrollmentWhere),
      tx
        .select({ enrollment: trainingEnrollments, person: people })
        .from(trainingEnrollments)
        .innerJoin(people, eq(people.id, trainingEnrollments.personId))
        .where(enrollmentWhere)
        .orderBy(asc(people.lastName), asc(people.firstName))
        .limit(listParams.perPage)
        .offset((listParams.page - 1) * listParams.perPage),
    ])

    const progress =
      practicals.length > 0 && enrollments.length > 0
        ? await tx
            .select({ row: trainingLessonProgress, evaluator: tenantUsers })
            .from(trainingLessonProgress)
            .leftJoin(
              tenantUsers,
              eq(tenantUsers.id, trainingLessonProgress.evaluatedByTenantUserId),
            )
            .where(
              and(
                inArray(
                  trainingLessonProgress.enrollmentId,
                  enrollments.map(({ enrollment }) => enrollment.id),
                ),
                inArray(
                  trainingLessonProgress.lessonId,
                  practicals.map((l) => l.id),
                ),
              ),
            )
        : []

    return {
      course,
      practicals,
      enrollments,
      enrollmentCount: Number(enrollmentCountRow?.c ?? 0),
      filteredEnrollmentCount: Number(filteredEnrollmentCountRow?.c ?? 0),
      progress,
    }
  })

  if (!data) notFound()
  const { course, practicals, enrollments, enrollmentCount, filteredEnrollmentCount, progress } =
    data

  const lessons: EvalLesson[] = practicals.map((l) => ({
    id: l.id,
    title: l.title,
    criteria: l.practicalCriteria ?? [],
  }))

  const progressKey = (enrollmentId: string, lessonId: string) => `${enrollmentId}:${lessonId}`
  const progressMap = new Map(
    progress.map((p) => [progressKey(p.row.enrollmentId, p.row.lessonId), p]),
  )

  const rows: EvalRow[] = enrollments.map(({ enrollment, person }) => ({
    enrollmentId: enrollment.id,
    personName: `${person.lastName}, ${person.firstName}`,
    employeeNo: person.employeeNo,
    enrollmentStatus: enrollment.status,
    cells: Object.fromEntries(
      lessons.map((l) => {
        const p = progressMap.get(progressKey(enrollment.id, l.id))
        return [
          l.id,
          {
            status: p?.row.status ?? 'not_started',
            evaluated: Boolean(p?.row.evaluatedByTenantUserId),
            evaluatorName: p?.evaluator?.displayName ?? null,
            completedAt: p?.row.completedAt?.toISOString() ?? null,
            criteriaResults: p?.row.criteriaResults ?? null,
            notes: p?.row.evaluationNotes ?? null,
          },
        ]
      }),
    ),
  }))

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: `/training/courses/${id}`, label: 'Back to course' }}
          title={tGenerated('m_0dcf71699d2da6', { value0: course.name })}
          subtitle={tGenerated('m_06da1e876df6a1')}
        />
      }
    >
      <GeneratedValue
        value={
          lessons.length === 0 ? (
            <EmptyState
              icon={<UserCheck size={32} />}
              title={tGenerated('m_01d18bea6e8486')}
              description={tGenerated('m_1701deb5c92f97')}
            />
          ) : (
            <div className="space-y-4">
              <form
                action={enrollLearner.bind(null, id)}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
              >
                <RemoteSelectField
                  name="personId"
                  lookup="training-evaluation-people"
                  contextId={id}
                  placeholder={tGenerated('m_1ca71e4464e800')}
                  searchPlaceholder={tGenerated('m_0b842b664b4f3b')}
                  sheetTitle="Enroll a learner"
                  clearable={false}
                  className="w-72 max-w-full"
                />
                <Button type="submit" size="sm">
                  <UserPlus size={14} /> <GeneratedText id="m_0f64da7946713b" />
                </Button>
              </form>
              <TableToolbar>
                <SearchInput placeholder={tGenerated('m_177e2342690354')} />
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  <GeneratedValue value={enrollmentCount} /> <GeneratedText id="m_147bb20e32281d" />
                </span>
              </TableToolbar>
              <GeneratedValue
                value={
                  rows.length === 0 ? (
                    <EmptyState
                      icon={<UserCheck size={32} />}
                      title={tGeneratedValue(
                        listParams.q
                          ? tGenerated('m_0e0d186265bbec')
                          : tGenerated('m_13d81dfeab7bc4'),
                      )}
                      description={tGeneratedValue(
                        listParams.q
                          ? tGenerated('m_11aabaa51ed686')
                          : tGenerated('m_1065b3e0a488c3'),
                      )}
                    />
                  ) : (
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                      <EvaluationsGrid
                        courseId={id}
                        lessons={lessons}
                        rows={rows}
                        bordered={false}
                      />
                      <Pagination
                        basePath={`/training/courses/${id}/evaluations`}
                        currentParams={sp}
                        total={filteredEnrollmentCount}
                        page={listParams.page}
                        perPage={listParams.perPage}
                      />
                    </div>
                  )
                }
              />
            </div>
          )
        }
      />
    </DetailPageLayout>
  )
}
