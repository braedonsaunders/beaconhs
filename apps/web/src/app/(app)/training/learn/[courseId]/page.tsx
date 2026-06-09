import { notFound } from 'next/navigation'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import {
  attachments,
  people,
  trainingClasses,
  trainingCourseModules,
  trainingCourses,
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { CoursePlayer, EnrollGate, type PlayerModule } from './_player'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  return { title: `Learn · ${courseId.slice(0, 8)}` }
}

export default async function PlayerPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, courseId))
      .limit(1)
    if (!course) return null

    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(eq(people.userId, ctx.userId))
      .limit(1)

    const mods = await tx
      .select()
      .from(trainingCourseModules)
      .where(
        and(eq(trainingCourseModules.courseId, courseId), isNull(trainingCourseModules.deletedAt)),
      )
      .orderBy(asc(trainingCourseModules.sortOrder), asc(trainingCourseModules.createdAt))

    const lessons = await tx
      .select()
      .from(trainingLessons)
      .where(and(eq(trainingLessons.courseId, courseId), isNull(trainingLessons.deletedAt)))
      .orderBy(asc(trainingLessons.sortOrder), asc(trainingLessons.createdAt))

    const classes = await tx
      .select({ id: trainingClasses.id, title: trainingClasses.title })
      .from(trainingClasses)
      .where(eq(trainingClasses.courseId, courseId))

    let enrollment: typeof trainingEnrollments.$inferSelect | null = null
    let progress: (typeof trainingLessonProgress.$inferSelect)[] = []
    if (person) {
      const [e] = await tx
        .select()
        .from(trainingEnrollments)
        .where(
          and(
            eq(trainingEnrollments.courseId, courseId),
            eq(trainingEnrollments.personId, person.id),
          ),
        )
        .limit(1)
      enrollment = e ?? null
      if (enrollment) {
        progress = await tx
          .select()
          .from(trainingLessonProgress)
          .where(eq(trainingLessonProgress.enrollmentId, enrollment.id))
      }
    }

    // Resolve media URLs for image/video/file blocks + media lessons.
    const attIds = new Set<string>()
    for (const l of lessons) {
      if (l.attachmentId) attIds.add(l.attachmentId)
      for (const b of l.contentBlocks ?? []) {
        if ((b.type === 'image' || b.type === 'file' || b.type === 'video') && 'attachmentId' in b && b.attachmentId) {
          attIds.add(b.attachmentId)
        }
      }
    }
    const atts = attIds.size
      ? await tx
          .select({ id: attachments.id, key: attachments.r2Key })
          .from(attachments)
          .where(inArray(attachments.id, [...attIds]))
      : []

    return { course, person, mods, lessons, classes, enrollment, progress, atts }
  })

  if (!data) notFound()
  const { course, person, mods, lessons, classes, enrollment, progress, atts } = data

  const attachmentUrls: Record<string, string | null> = Object.fromEntries(
    atts.map((a) => [a.id, a.key ? publicUrl(a.key) : null]),
  )
  const classTitleById = new Map(classes.map((c) => [c.id, c.title]))
  const statusByLesson = new Map(progress.map((p) => [p.lessonId, p.status]))

  const modules: PlayerModule[] = mods.map((m) => ({
    id: m.id,
    title: m.title,
    lessons: lessons
      .filter((l) => l.moduleId === m.id)
      .map((l) => ({
        id: l.id,
        title: l.title,
        kind: l.kind,
        completionRule: l.completionRule,
        isRequired: l.isRequired,
        blocks: l.contentBlocks ?? [],
        embedUrl: l.embedUrl,
        attachmentId: l.attachmentId,
        assessmentTypeId: l.assessmentTypeId,
        classTitle: l.classId ? classTitleById.get(l.classId) ?? null : null,
        durationMinutes: l.durationMinutes,
        status: statusByLesson.get(l.id) ?? 'not_started',
      })),
  }))

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/training/learn', label: 'My Learning' }}
          title={course.name}
          subtitle={course.code}
        />
      }
    >
      {!person ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-slate-500">
            Your account isn&apos;t linked to a worker profile yet, so we can&apos;t track your
            progress. Ask an admin to link your People record.
          </CardContent>
        </Card>
      ) : !enrollment ? (
        <EnrollGate courseId={courseId} courseName={course.name} summary={course.description} />
      ) : (
        <CoursePlayer
          courseName={course.name}
          modules={modules}
          enrollmentId={enrollment.id}
          attachmentUrls={attachmentUrls}
          completed={enrollment.status === 'completed'}
          certificateRecordId={enrollment.recordId ?? null}
        />
      )}
    </DetailPageLayout>
  )
}
