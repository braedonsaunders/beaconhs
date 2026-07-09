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
import { publicUrl } from '@beaconhs/storage'
import type { ModuleLite } from '../_workspace'
import type { AssessmentMeta, AttachmentMeta, ItemContent, QuizQuestion } from '../_presenter'

export type { AssessmentMeta }

export type CoursePresentation = {
  course: typeof trainingCourses.$inferSelect
  modules: ModuleLite[]
  /** Slim list for the builder's library picker. */
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

  const contentItemRows = await tx
    .select()
    .from(trainingContentItems)
    .where(isNull(trainingContentItems.deletedAt))
    .orderBy(asc(trainingContentItems.title))

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

  // Resolve media URLs for lesson media + slide images + block images across
  // both lessons and any library items they reference.
  const attIds = new Set<string>()
  const collectBlocks = (blocks: (typeof lessons)[number]['contentBlocks'] | null) => {
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
  const collectSlides = (slides: (typeof lessons)[number]['slides'] | null) => {
    for (const s of slides ?? []) {
      if (s.imageAttachmentId) attIds.add(s.imageAttachmentId)
      for (const el of s.elements ?? []) {
        if (el.kind === 'image' && el.attachmentId) attIds.add(el.attachmentId)
      }
      collectBlocks(Array.isArray(s.body) ? s.body : null)
      collectBlocks(Array.isArray(s.left) ? s.left : null)
      collectBlocks(Array.isArray(s.right) ? s.right : null)
    }
  }
  for (const l of lessons) {
    if (l.attachmentId) attIds.add(l.attachmentId)
    if (l.sourceAttachmentId) attIds.add(l.sourceAttachmentId)
    collectBlocks(l.contentBlocks)
    collectSlides(l.slides)
  }
  const usedItemIds = new Set(lessons.map((l) => l.contentItemId).filter(Boolean))
  for (const it of contentItemRows) {
    if (!usedItemIds.has(it.id)) continue
    if (it.attachmentId) attIds.add(it.attachmentId)
    collectBlocks(it.contentBlocks)
    collectSlides(it.slides)
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
        url: a.key ? publicUrl(a.key) : null,
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
        contentBlocks: it.contentBlocks ?? [],
        slides: it.slides ?? [],
        embedUrl: it.embedUrl,
        attachmentId: it.attachmentId,
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
        embedUrl: l.embedUrl,
        contentItemId: l.contentItemId,
        durationMinutes: l.durationMinutes,
        contentBlocks: l.contentBlocks ?? [],
        contentJson: l.contentJson,
        contentHtml: l.contentHtml,
        slides: l.slides ?? [],
        practicalCriteria: l.practicalCriteria ?? [],
        importStatus: l.importStatus,
        importError: l.importError,
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
