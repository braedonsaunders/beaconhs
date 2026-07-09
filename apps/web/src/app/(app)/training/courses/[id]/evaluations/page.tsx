import { notFound } from 'next/navigation'
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm'
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
import { PersonSelectField } from '@/components/person-select-field'
import { enrollLearner } from './_actions'
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

    // Active people not yet enrolled — candidates for the staff enroll control.
    const enrolledPersonIds = enrollments.map((e) => e.enrollment.personId)
    const candidates = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
      })
      .from(people)
      .where(
        and(
          isNull(people.deletedAt),
          eq(people.status, 'active'),
          ...(enrolledPersonIds.length ? [notInArray(people.id, enrolledPersonIds)] : []),
        ),
      )
      .orderBy(asc(people.lastName), asc(people.firstName))

    return { course, practicals, enrollments, progress, candidates }
  })

  if (!data) notFound()
  const { course, practicals, enrollments, progress, candidates } = data

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
      ) : (
        <div className="space-y-4">
          <form
            action={enrollLearner.bind(null, id)}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
          >
            <PersonSelectField
              name="personId"
              options={candidates.map((p) => ({
                value: p.id,
                label: `${p.lastName}, ${p.firstName}`,
                hint: p.employeeNo ?? undefined,
              }))}
              placeholder="Enroll a learner…"
              searchPlaceholder="Search people…"
              sheetTitle="Enroll a learner"
              clearable={false}
              className="w-72 max-w-full"
            />
            <Button type="submit" size="sm">
              <UserPlus size={14} /> Enroll
            </Button>
          </form>
          {rows.length === 0 ? (
            <EmptyState
              icon={<UserCheck size={32} />}
              title="No enrolled learners"
              description="Enroll a learner above to start signing off practicals."
            />
          ) : (
            <EvaluationsGrid courseId={id} lessons={lessons} rows={rows} />
          )}
        </div>
      )}
    </DetailPageLayout>
  )
}
