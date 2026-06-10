import { notFound } from 'next/navigation'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { Card, CardContent, DetailHeader } from '@beaconhs/ui'
import {
  attachments,
  people,
  tenantUsers,
  trainingClasses,
  trainingContentItems,
  trainingCourseModules,
  trainingCourses,
  trainingEnrollments,
  trainingLessonProgress,
  trainingLessons,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { lessonProseCss } from '../../_editor/prose'
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
    let progress: {
      row: typeof trainingLessonProgress.$inferSelect
      evaluatorName: string | null
    }[] = []
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
        const rows = await tx
          .select({ row: trainingLessonProgress, evaluator: tenantUsers })
          .from(trainingLessonProgress)
          .leftJoin(
            tenantUsers,
            eq(tenantUsers.id, trainingLessonProgress.evaluatedByTenantUserId),
          )
          .where(eq(trainingLessonProgress.enrollmentId, enrollment.id))
        progress = rows.map((r) => ({ row: r.row, evaluatorName: r.evaluator?.displayName ?? null }))
      }
    }

    // Library items referenced by lessons (reuse-from-library).
    const itemIds = [
      ...new Set(lessons.map((l) => l.contentItemId).filter((x): x is string => !!x)),
    ]
    const items = itemIds.length
      ? await tx.select().from(trainingContentItems).where(inArray(trainingContentItems.id, itemIds))
      : []

    // Resolve media URLs for image/video/file blocks + media lessons + library
    // items + slide decks (page images and region blocks).
    const attIds = new Set<string>()
    const collectBlockAtts = (blocks: (typeof lessons)[number]['contentBlocks'] | null) => {
      for (const b of blocks ?? []) {
        if (
          (b.type === 'image' || b.type === 'file' || b.type === 'video') &&
          'attachmentId' in b &&
          b.attachmentId
        ) {
          attIds.add(b.attachmentId)
        }
      }
    }
    const collectSlideAtts = (slides: (typeof lessons)[number]['slides'] | null) => {
      for (const s of slides ?? []) {
        if (s.imageAttachmentId) attIds.add(s.imageAttachmentId)
        collectBlockAtts(Array.isArray(s.body) ? s.body : null)
        collectBlockAtts(Array.isArray(s.left) ? s.left : null)
        collectBlockAtts(Array.isArray(s.right) ? s.right : null)
      }
    }
    for (const l of lessons) {
      if (l.attachmentId) attIds.add(l.attachmentId)
      collectBlockAtts(l.contentBlocks)
      collectSlideAtts(l.slides)
    }
    for (const it of items) {
      if (it.attachmentId) attIds.add(it.attachmentId)
      collectBlockAtts(it.contentBlocks)
      collectSlideAtts(it.slides)
    }
    const atts = attIds.size
      ? await tx
          .select({ id: attachments.id, key: attachments.r2Key })
          .from(attachments)
          .where(inArray(attachments.id, [...attIds]))
      : []

    return { course, person, mods, lessons, classes, enrollment, progress, atts, items }
  })

  if (!data) notFound()
  const { course, person, mods, lessons, classes, enrollment, progress, atts, items } = data

  const attachmentUrls: Record<string, string | null> = Object.fromEntries(
    atts.map((a) => [a.id, a.key ? publicUrl(a.key) : null]),
  )
  const classTitleById = new Map(classes.map((c) => [c.id, c.title]))
  const progressByLesson = new Map(progress.map((p) => [p.row.lessonId, p]))
  const itemById = new Map(items.map((i) => [i.id, i]))

  const modules: PlayerModule[] = mods.map((m) => ({
    id: m.id,
    title: m.title,
    lessons: lessons
      .filter((l) => l.moduleId === m.id)
      .map((l) => {
        // Library-backed lessons render the referenced item's content.
        const item = l.contentItemId ? itemById.get(l.contentItemId) : null
        const prog = progressByLesson.get(l.id)
        return {
          id: l.id,
          title: l.title,
          kind: item ? item.kind : l.kind,
          completionRule: l.completionRule,
          isRequired: l.isRequired,
          blocks: item ? item.contentBlocks ?? [] : l.contentBlocks ?? [],
          contentHtml: item ? item.contentHtml : l.contentHtml,
          slides: item ? item.slides ?? [] : l.slides ?? [],
          practicalCriteria: l.practicalCriteria ?? [],
          evaluation: prog?.row.evaluatedByTenantUserId
            ? {
                evaluatorName: prog.evaluatorName,
                notes: prog.row.evaluationNotes,
                signatureDataUrl: prog.row.evaluationSignatureDataUrl,
                criteriaResults: prog.row.criteriaResults ?? null,
                completedAt: prog.row.completedAt?.toISOString() ?? null,
              }
            : null,
          embedUrl: item ? item.embedUrl : l.embedUrl,
          attachmentId: item ? item.attachmentId : l.attachmentId,
          assessmentTypeId: l.assessmentTypeId,
          classTitle: l.classId ? classTitleById.get(l.classId) ?? null : null,
          durationMinutes: l.durationMinutes,
          status: prog?.row.status ?? 'not_started',
        }
      }),
  }))

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/my/training', label: 'My Learning' }}
          title={course.name}
          subtitle={course.code}
        />
      }
    >
      <style dangerouslySetInnerHTML={{ __html: lessonProseCss('.lesson-prose') }} />
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
