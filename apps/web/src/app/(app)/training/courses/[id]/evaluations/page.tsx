import { notFound } from 'next/navigation'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { DetailHeader, EmptyState } from '@beaconhs/ui'
import { UserCheck } from 'lucide-react'
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
import { EvaluationsGrid, type EvalLesson, type EvalRow } from './_evaluate'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Evaluations · ${id.slice(0, 8)}` }
}

export default async function CourseEvaluationsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
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

    const enrollments = await tx
      .select({ enrollment: trainingEnrollments, person: people })
      .from(trainingEnrollments)
      .innerJoin(people, eq(people.id, trainingEnrollments.personId))
      .where(and(eq(trainingEnrollments.courseId, id), isNull(trainingEnrollments.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName))

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
              inArray(
                trainingLessonProgress.lessonId,
                practicals.map((l) => l.id),
              ),
            )
        : []

    return { course, practicals, enrollments, progress }
  })

  if (!data) notFound()
  const { course, practicals, enrollments, progress } = data

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
          title={`Evaluations · ${course.name}`}
          subtitle="Sign learners off on the practical components of this course"
        />
      }
    >
      {lessons.length === 0 ? (
        <EmptyState
          icon={<UserCheck size={32} />}
          title="No practical tests in this course"
          description="Add a “Practical / physical test” lesson in the studio, then sign learners off here."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<UserCheck size={32} />}
          title="No enrolled learners"
          description="Learners appear here for sign-off once they start the course."
        />
      ) : (
        <EvaluationsGrid courseId={id} lessons={lessons} rows={rows} />
      )}
    </DetailPageLayout>
  )
}
