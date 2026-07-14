// Shared loader for everything the course presenter needs: the module/lesson
// tree, reusable library-item content, quiz questions + assessment metadata,
// and resolved media URLs. Used by both the course builder page (whose "Play"
// preview walks the same data) and the classroom present route launched from a
// class. Keeping it in one place means the instructor preview and the live
// classroom run can never drift.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  attachments,
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingContentItems,
  trainingCourseModules,
  trainingCourses,
  trainingLessons,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { safeTrainingExternalUrl } from '@/lib/training-external-url'
import { configuredTrainingBlockedOrigins } from '@/lib/training-external-url.server'
import type { ModuleLite } from '../_workspace'
import type { AssessmentMeta, AttachmentMeta, ItemContent, QuizQuestion } from '../_presenter'

type CoursePresentation = {
  course: typeof trainingCourses.$inferSelect
  modules: ModuleLite[]
  /** Library items referenced by this course (picker candidates load remotely). */
  contentItems: { id: string; title: string; kind: string }[]
  itemContents: Record<string, ItemContent>
  quizQuestions: Record<string, QuizQuestion[]>
  assessmentMeta: Record<string, AssessmentMeta>
  attachmentMeta: Record<string, AttachmentMeta>
  attachmentUrls: Record<string, string | null>
}

export async function loadCoursePresentation(
  tx: Database,
  courseId: string,
): Promise<CoursePresentation | null> {
  const [course] = await tx
    .select()
    .from(trainingCourses)
    .where(eq(trainingCourses.id, courseId))
    .limit(1)
  if (!course) return null
  const trainingUrlOptions = { blockedOrigins: configuredTrainingBlockedOrigins() }

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

  const usedItemIds = [
    ...new Set(lessons.map((lesson) => lesson.contentItemId).filter((id): id is string => !!id)),
  ]
  const contentItemRows = usedItemIds.length
    ? await tx
        .select()
        .from(trainingContentItems)
        .where(
          and(
            isNull(trainingContentItems.deletedAt),
            inArray(trainingContentItems.id, usedItemIds),
          ),
        )
        .orderBy(asc(trainingContentItems.title))
    : []

  // Quiz questions + assessment metadata for the quiz guide page.
  const usedTypeIds = [
    ...new Set(lessons.map((l) => l.assessmentTypeId).filter((x): x is string => !!x)),
  ]
  const questions = usedTypeIds.length
    ? await tx
        .select({
          id: trainingAssessmentTypeQuestions.id,
          typeId: trainingAssessmentTypeQuestions.typeId,
          prompt: trainingAssessmentTypeQuestions.prompt,
          kind: trainingAssessmentTypeQuestions.kind,
          options: trainingAssessmentTypeQuestions.options,
        })
        .from(trainingAssessmentTypeQuestions)
        .where(inArray(trainingAssessmentTypeQuestions.typeId, usedTypeIds))
        .orderBy(asc(trainingAssessmentTypeQuestions.entityOrder))
    : []
  const typeRows = usedTypeIds.length
    ? await tx
        .select({
          id: trainingAssessmentTypes.id,
          name: trainingAssessmentTypes.name,
          passingScore: trainingAssessmentTypes.passingScore,
        })
        .from(trainingAssessmentTypes)
        .where(inArray(trainingAssessmentTypes.id, usedTypeIds))
    : []

  // Resolve uploaded media plus the PPTX masters used by Collabora playback.
  const attIds = new Set<string>()
  for (const l of lessons) {
    if (l.attachmentId) attIds.add(l.attachmentId)
    if (l.sourceAttachmentId) attIds.add(l.sourceAttachmentId)
  }
  for (const it of contentItemRows) {
    if (it.attachmentId) attIds.add(it.attachmentId)
    if (it.sourceAttachmentId) attIds.add(it.sourceAttachmentId)
  }
  const atts = attIds.size
    ? await tx
        .select({
          id: attachments.id,
          key: attachments.r2Key,
          contentType: attachments.contentType,
          filename: attachments.filename,
        })
        .from(attachments)
        .where(inArray(attachments.id, [...attIds]))
    : []

  const attachmentMeta: Record<string, AttachmentMeta> = Object.fromEntries(
    atts.map((a) => [
      a.id,
      {
        url: a.key ? attachmentUrl(a.id) : null,
        contentType: a.contentType ?? null,
        filename: a.filename ?? null,
      },
    ]),
  )
  const attachmentUrls: Record<string, string | null> = Object.fromEntries(
    Object.entries(attachmentMeta).map(([id, m]) => [id, m.url]),
  )

  const quizQuestions: Record<string, QuizQuestion[]> = {}
  for (const q of questions) {
    ;(quizQuestions[q.typeId] ??= []).push({
      id: q.id,
      prompt: q.prompt,
      kind: q.kind,
      options: q.options ?? null,
    })
  }
  const assessmentMeta: Record<string, AssessmentMeta> = Object.fromEntries(
    typeRows.map((t) => [
      t.id,
      {
        name: t.name,
        passingScore: t.passingScore,
        questionCount: quizQuestions[t.id]?.length ?? 0,
      },
    ]),
  )

  const itemContents: Record<string, ItemContent> = Object.fromEntries(
    contentItemRows.map((it) => [
      it.id,
      {
        kind: it.kind,
        contentHtml: it.contentHtml,
        embedUrl: safeTrainingExternalUrl(it.embedUrl, trainingUrlOptions)?.url ?? null,
        attachmentId: it.attachmentId,
        sourceAttachmentId: it.sourceAttachmentId,
      },
    ]),
  )

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
        embedUrl: safeTrainingExternalUrl(l.embedUrl, trainingUrlOptions)?.url ?? null,
        contentItemId: l.contentItemId,
        durationMinutes: l.durationMinutes,
        minTimeSeconds: l.minTimeSeconds,
        contentHtml: l.contentHtml,
        practicalCriteria: l.practicalCriteria ?? [],
        sourceAttachmentId: l.sourceAttachmentId,
        sourceFilename: l.sourceAttachmentId
          ? (attachmentMeta[l.sourceAttachmentId]?.filename ?? null)
          : null,
      })),
  }))

  return {
    course,
    modules,
    contentItems: contentItemRows.map((it) => ({ id: it.id, title: it.title, kind: it.kind })),
    itemContents,
    quizQuestions,
    assessmentMeta,
    attachmentMeta,
    attachmentUrls,
  }
}
