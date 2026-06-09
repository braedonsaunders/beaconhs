import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { Button, DetailHeader } from '@beaconhs/ui'
import {
  trainingAssessmentTypes,
  trainingClasses,
  trainingCourseModules,
  trainingCourses,
  trainingLessons,
} from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { DetailPageLayout } from '@/components/page-layout'
import { CurriculumStudio, type ModuleLite } from './_studio'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Studio · ${id.slice(0, 8)}` }
}

export default async function CourseStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireModuleManage('training')

  const data = await ctx.db(async (tx) => {
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(eq(trainingCourses.id, id))
      .limit(1)
    if (!course) return null

    const mods = await tx
      .select()
      .from(trainingCourseModules)
      .where(and(eq(trainingCourseModules.courseId, id), isNull(trainingCourseModules.deletedAt)))
      .orderBy(asc(trainingCourseModules.sortOrder), asc(trainingCourseModules.createdAt))

    const lessons = await tx
      .select()
      .from(trainingLessons)
      .where(and(eq(trainingLessons.courseId, id), isNull(trainingLessons.deletedAt)))
      .orderBy(asc(trainingLessons.sortOrder), asc(trainingLessons.createdAt))

    const aTypes = await tx
      .select({ id: trainingAssessmentTypes.id, name: trainingAssessmentTypes.name })
      .from(trainingAssessmentTypes)
      .orderBy(asc(trainingAssessmentTypes.name))

    const cls = await tx
      .select({ id: trainingClasses.id, title: trainingClasses.title })
      .from(trainingClasses)
      .where(eq(trainingClasses.courseId, id))
      .orderBy(asc(trainingClasses.startsAt))

    return { course, mods, lessons, aTypes, cls }
  })

  if (!data) notFound()
  const { course, mods, lessons, aTypes, cls } = data

  const modules: ModuleLite[] = mods.map((m) => ({
    id: m.id,
    title: m.title,
    description: m.description,
    lessons: lessons
      .filter((l) => l.moduleId === m.id)
      .map((l) => ({
        id: l.id,
        moduleId: l.moduleId,
        title: l.title,
        kind: l.kind,
        isRequired: l.isRequired,
        completionRule: l.completionRule,
        assessmentTypeId: l.assessmentTypeId,
        classId: l.classId,
        attachmentId: l.attachmentId,
        embedUrl: l.embedUrl,
        durationMinutes: l.durationMinutes,
        contentBlocks: l.contentBlocks,
      })),
  }))

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: `/training/courses/${id}`, label: 'Back to course' }}
          title={`Studio · ${course.name}`}
          subtitle="Build the course curriculum and content"
          actions={
            <Link href={`/training/learn/${id}`}>
              <Button variant="outline">Preview as learner</Button>
            </Link>
          }
        />
      }
    >
      <CurriculumStudio courseId={id} modules={modules} assessmentTypes={aTypes} classes={cls} />
    </DetailPageLayout>
  )
}
