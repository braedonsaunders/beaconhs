import { getGeneratedValueTranslations, getGeneratedTranslations } from '@/i18n/generated.server'

import { GeneratedText, GeneratedValue } from '@/i18n/generated'
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
import { attachmentUrl } from '@/lib/attachment-url'
import { htmlToSnippet } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { DetailPageLayout } from '@/components/page-layout'
import { safeTrainingExternalUrl } from '@/lib/training-external-url'
import { configuredTrainingBlockedOrigins } from '@/lib/training-external-url.server'
import { deliveryMeta } from '../../_lib/delivery'
import { lessonProseCss } from '../../_editor/prose'
import {
  findOutstandingCourseRequirement,
  requiresEnrollmentRenewal,
} from '../_lib/compliance-requirement'
import { CoursePlayer, EnrollGate, OnlineCoursePlayer, type PlayerModule } from './_player'
import { isUuid } from '@/lib/list-params'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }) {
  const tGenerated = await getGeneratedTranslations()
  const { courseId } = await params
  return { title: tGenerated('m_10fabf3f2e34dd', { value0: courseId.slice(0, 8) }) }
}

export default async function PlayerPage({ params }: { params: Promise<{ courseId: string }> }) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const { courseId } = await params
  if (!isUuid(courseId)) notFound()

  const ctx = await requireRequestContext()

  const data = await ctx.db(async (tx) => {
    const [course] = await tx
      .select()
      .from(trainingCourses)
      .where(and(eq(trainingCourses.id, courseId), isNull(trainingCourses.deletedAt)))
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
    let renewalRequired = false
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
      if (enrollment?.status === 'completed') {
        const requirement = await findOutstandingCourseRequirement(tx, {
          tenantId: ctx.tenantId,
          personId: person.id,
          courseId,
        })
        renewalRequired = requiresEnrollmentRenewal(enrollment, requirement)
      }
      if (enrollment) {
        const rows = await tx
          .select({ row: trainingLessonProgress, evaluator: tenantUsers })
          .from(trainingLessonProgress)
          .leftJoin(tenantUsers, eq(tenantUsers.id, trainingLessonProgress.evaluatedByTenantUserId))
          .where(eq(trainingLessonProgress.enrollmentId, enrollment.id))
        progress = rows.map((r) => ({
          row: r.row,
          evaluatorName: r.evaluator?.displayName ?? null,
        }))
      }
    }

    // Library items referenced by lessons (reuse-from-library).
    const itemIds = [
      ...new Set(lessons.map((l) => l.contentItemId).filter((x): x is string => !!x)),
    ]
    const items = itemIds.length
      ? await tx
          .select()
          .from(trainingContentItems)
          .where(inArray(trainingContentItems.id, itemIds))
      : []

    // Resolve media URLs for media lessons, library items, and slide decks.
    const attIds = new Set<string>()
    for (const l of lessons) {
      if (l.attachmentId) attIds.add(l.attachmentId)
    }
    for (const it of items) {
      if (it.attachmentId) attIds.add(it.attachmentId)
    }
    for (const row of progress) {
      if (row.row.evaluationSignatureAttachmentId) {
        attIds.add(row.row.evaluationSignatureAttachmentId)
      }
    }
    const atts = attIds.size
      ? await tx
          .select({ id: attachments.id, key: attachments.r2Key })
          .from(attachments)
          .where(inArray(attachments.id, [...attIds]))
      : []

    return {
      course,
      person,
      mods,
      lessons,
      classes,
      enrollment,
      renewalRequired,
      progress,
      atts,
      items,
    }
  })

  if (!data) notFound()
  const {
    course,
    person,
    mods,
    lessons,
    classes,
    enrollment,
    renewalRequired,
    progress,
    atts,
    items,
  } = data

  const attachmentUrls: Record<string, string | null> = Object.fromEntries(
    atts.map((a) => [a.id, a.key ? attachmentUrl(a.id) : null]),
  )
  const classTitleById = new Map(classes.map((c) => [c.id, c.title]))
  const progressByLesson = new Map(progress.map((p) => [p.row.lessonId, p]))
  const itemById = new Map(items.map((i) => [i.id, i]))
  const trainingUrlOptions = { blockedOrigins: configuredTrainingBlockedOrigins() }

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
          contentHtml: item ? item.contentHtml : l.contentHtml,
          practicalCriteria: l.practicalCriteria ?? [],
          evaluation: prog?.row.evaluatedByTenantUserId
            ? {
                evaluatorName: prog.evaluatorName,
                notes: prog.row.evaluationNotes,
                signatureDataUrl: prog.row.evaluationSignatureAttachmentId
                  ? (attachmentUrls[prog.row.evaluationSignatureAttachmentId] ?? null)
                  : null,
                criteriaResults: prog.row.criteriaResults ?? null,
                completedAt: prog.row.completedAt?.toISOString() ?? null,
              }
            : null,
          embedUrl:
            safeTrainingExternalUrl(item ? item.embedUrl : l.embedUrl, trainingUrlOptions)?.url ??
            null,
          attachmentId: item ? item.attachmentId : l.attachmentId,
          assessmentTypeId: l.assessmentTypeId,
          classTitle: l.classId ? (classTitleById.get(l.classId) ?? null) : null,
          durationMinutes: l.durationMinutes,
          minTimeSeconds: l.minTimeSeconds,
          status: prog?.row.status ?? 'not_started',
        }
      }),
  }))

  return (
    <DetailPageLayout
      header={
        <DetailHeader
          back={{ href: '/my/training', label: 'My Learning' }}
          title={tGeneratedValue(course.name)}
          subtitle={tGeneratedValue(course.code)}
        />
      }
    >
      <style dangerouslySetInnerHTML={{ __html: lessonProseCss('.lesson-prose') }} />
      <GeneratedValue
        value={
          !person ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_19c21b3540290c" />
              </CardContent>
            </Card>
          ) : course.deliveryType === 'external_certificate' ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                <GeneratedValue
                  value={
                    renewalRequired ? (
                      <GeneratedText id="m_139ffe50389d3a" />
                    ) : (
                      <GeneratedText id="m_1b553f8e636b13" />
                    )
                  }
                />
                <GeneratedText id="m_1dfba6c600e8f3" />
                <GeneratedValue value={' '} />
                <a
                  href="/my/training?tab=records"
                  className="text-teal-700 underline dark:text-teal-300"
                >
                  <GeneratedText id="m_1eac86f811af44" />
                </a>
                .
              </CardContent>
            </Card>
          ) : renewalRequired && !deliveryMeta(course.deliveryType).selfLaunch ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_0ff828bd1b5676" />
              </CardContent>
            </Card>
          ) : renewalRequired ? (
            <EnrollGate
              courseId={courseId}
              courseName={course.name}
              summary={htmlToSnippet(course.description, 240) || null}
              renewal
            />
          ) : !enrollment && !deliveryMeta(course.deliveryType).selfLaunch ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                <GeneratedText id="m_0f2c9bd0066ecf" />
                <GeneratedValue value={' '} />
                <a href="/my/training" className="text-teal-700 underline dark:text-teal-300">
                  <GeneratedText id="m_1eac86f811af44" />
                </a>
                .
              </CardContent>
            </Card>
          ) : !enrollment ? (
            <EnrollGate
              courseId={courseId}
              courseName={course.name}
              summary={htmlToSnippet(course.description, 240) || null}
            />
          ) : course.deliveryType === 'online' ? (
            <OnlineCoursePlayer
              enrollmentId={enrollment.id}
              instructionsHtml={course.instructions}
              onlineUrl={course.onlineUrl}
              completed={enrollment.status === 'completed'}
              certificateRecordId={enrollment.recordId ?? null}
            />
          ) : (
            <CoursePlayer
              modules={modules}
              enrollmentId={enrollment.id}
              attachmentUrls={attachmentUrls}
              completed={enrollment.status === 'completed'}
              certificateRecordId={enrollment.recordId ?? null}
              issuesRecord={deliveryMeta(course.deliveryType).autoIssuesRecord}
            />
          )
        }
      />
    </DetailPageLayout>
  )
}
