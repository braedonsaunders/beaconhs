import { notFound } from 'next/navigation'
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import {
  people,
  trainingAssessmentTypes,
  trainingClasses,
  trainingCourseFiles,
  trainingCourses,
  trainingRecords,
  tenants,
  attachments,
} from '@beaconhs/db/schema'
import { publicUrl } from '@beaconhs/storage'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { isUuid } from '@/lib/list-params'
import { courseCredentialOutputIds, enabledCredentialOutputs } from '@/lib/credential-designs'
import { CourseWorkspace } from './_workspace'
import { loadCoursePresentation } from './_lib/presentation'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Course · ${id.slice(0, 8)}` }
}

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Guard non-UUID segments (e.g. a stale /courses/new link) — the id column is
  // a uuid, so a bad value would throw at the DB instead of a clean 404.
  if (!isUuid(id)) notFound()
  const ctx = await requireModuleManage('training')

  const data = await ctx.db(async (tx) => {
    // The module/lesson tree, library content, quiz + assessment metadata, and
    // media URLs are loaded by the shared presentation loader (the same data the
    // classroom present route uses).
    const presentation = await loadCoursePresentation(tx, id)
    if (!presentation) return null

    // All assessment types (not just the ones in use) power the lesson editor's
    // quiz picker.
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

    return { presentation, aTypes, cls, recs, recTotal, courseFiles, credentialOutputs }
  })

  if (!data) notFound()
  const { presentation, aTypes, cls, recs, recTotal, courseFiles, credentialOutputs } = data
  const { course } = presentation

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
        requiresEvaluator: course.requiresEvaluator,
        credentialOutputIds: courseCredentialOutputIds(course.metadata),
      }}
      credentialOutputs={credentialOutputs}
      modules={presentation.modules}
      assessmentTypes={aTypes}
      classes={cls.map((c) => ({ id: c.id, title: c.title, startsAt: c.startsAt.toISOString() }))}
      contentItems={presentation.contentItems}
      itemContents={presentation.itemContents}
      quizQuestions={presentation.quizQuestions}
      assessmentMeta={presentation.assessmentMeta}
      attachmentMeta={presentation.attachmentMeta}
      attachmentUrls={presentation.attachmentUrls}
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
