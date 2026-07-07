import { notFound } from 'next/navigation'
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  attachments,
  people,
  trainingAssessmentTypeQuestions,
  trainingAssessmentTypes,
  trainingClasses,
  trainingContentItems,
  trainingCourseFiles,
  trainingCourseModules,
  trainingCourses,
  trainingLessons,
  trainingRecords,
  tenants,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { courseCredentialOutputIds, enabledCredentialOutputs } from '@/lib/credential-designs'
import { CourseWorkspace, type ModuleLite } from './_workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Course · ${id.slice(0, 8)}` }
}

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
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
      .where(isNull(trainingAssessmentTypes.deletedAt))
      .orderBy(asc(trainingAssessmentTypes.name))

    const cls = await tx
      .select({
        id: trainingClasses.id,
        title: trainingClasses.title,
        startsAt: trainingClasses.startsAt,
      })
      .from(trainingClasses)
      .where(eq(trainingClasses.courseId, id))
      .orderBy(desc(trainingClasses.startsAt))

    const contentItems = await tx
      .select()
      .from(trainingContentItems)
      .where(isNull(trainingContentItems.deletedAt))
      .orderBy(asc(trainingContentItems.title))

    // Quiz questions for the presenter's read-only walkthrough.
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

    // Latest completion records (compact, for the rail) + total.
    const [recTotal] = await tx
      .select({ c: count() })
      .from(trainingRecords)
      .where(and(eq(trainingRecords.courseId, id), isNull(trainingRecords.deletedAt)))
    const recs = await tx
      .select({ record: trainingRecords, person: people })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .where(and(eq(trainingRecords.courseId, id), isNull(trainingRecords.deletedAt)))
      .orderBy(desc(trainingRecords.completedOn))
      .limit(15)

    const courseFiles = await tx
      .select({ file: trainingCourseFiles, att: attachments })
      .from(trainingCourseFiles)
      .leftJoin(attachments, eq(attachments.id, trainingCourseFiles.attachmentId))
      .where(eq(trainingCourseFiles.courseId, id))
      .orderBy(asc(trainingCourseFiles.sortOrder), asc(trainingCourseFiles.createdAt))

    // Media URLs for the editors: lesson media + slide images + block images.
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
    // Library items referenced by lessons render in the presenter too.
    const usedItemIds = new Set(lessons.map((l) => l.contentItemId).filter(Boolean))
    for (const it of contentItems) {
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

    const [tenant] = await tx
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)
    const credentialOutputs = enabledCredentialOutputs(tenant?.settings).map((output) => ({
      id: output.id,
      name: output.name,
      format: output.format,
    }))

    return {
      course,
      mods,
      lessons,
      aTypes,
      cls,
      contentItems,
      questions,
      recs,
      recTotal,
      courseFiles,
      atts,
      credentialOutputs,
    }
  })

  if (!data) notFound()
  const {
    course,
    mods,
    lessons,
    aTypes,
    cls,
    contentItems,
    questions,
    recs,
    recTotal,
    courseFiles,
    atts,
    credentialOutputs,
  } = data

  const attachmentMeta = Object.fromEntries(
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

  const quizQuestions: Record<
    string,
    {
      id: string
      prompt: string
      kind: string
      options: { value: string; label: string }[] | null
    }[]
  > = {}
  for (const q of questions) {
    ;(quizQuestions[q.typeId] ??= []).push({
      id: q.id,
      prompt: q.prompt,
      kind: q.kind,
      options: q.options ?? null,
    })
  }

  const itemContents = Object.fromEntries(
    contentItems.map((it) => [
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

  return (
    <CourseWorkspace
      course={{
        id: course.id,
        name: course.name,
        code: course.code,
        description: course.description,
        deliveryType: course.deliveryType,
        onlineUrl: course.onlineUrl,
        instructions: course.instructions,
        durationMinutes: course.durationMinutes,
        validForMonths: course.validForMonths,
        credentialOutputIds: courseCredentialOutputIds(course.metadata),
      }}
      credentialOutputs={credentialOutputs}
      modules={modules}
      assessmentTypes={aTypes}
      classes={cls.map((c) => ({ id: c.id, title: c.title, startsAt: c.startsAt.toISOString() }))}
      contentItems={contentItems.map((it) => ({ id: it.id, title: it.title, kind: it.kind }))}
      itemContents={itemContents}
      quizQuestions={quizQuestions}
      attachmentMeta={attachmentMeta}
      attachmentUrls={attachmentUrls}
      records={recs.map(({ record, person }) => ({
        id: record.id,
        personName: `${person.lastName}, ${person.firstName}`,
        employeeNo: person.employeeNo,
        completedOn: record.completedOn,
        expiresOn: record.expiresOn,
      }))}
      recordsTotal={Number(recTotal?.c ?? 0)}
      files={courseFiles.map(({ file, att }) => ({
        id: file.id,
        label: file.label,
        filename: att?.filename ?? null,
        url: att?.r2Key ? publicUrl(att.r2Key) : null,
        sizeBytes: att?.sizeBytes != null ? Number(att.sizeBytes) : null,
      }))}
    />
  )
}
