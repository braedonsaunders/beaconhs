import { notFound } from 'next/navigation'
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import {
  people,
  trainingClasses,
  trainingCourseFiles,
  trainingRecords,
  tenants,
  attachments,
} from '@beaconhs/db/schema'
import { attachmentUrl } from '@/lib/attachment-url'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { isUuid, parsePrefixedListParams, pickString } from '@/lib/list-params'
import { courseCredentialOutputIds, enabledCredentialOutputs } from '@/lib/credential-designs'
import { CourseWorkspace } from './_workspace'
import { loadCoursePresentation } from './_lib/presentation'

export const dynamic = 'force-dynamic'

const RECORD_SORTS = ['recent', 'name', 'expiry'] as const
const CLASS_SORTS = ['upcoming', 'recent'] as const
const FILE_SORTS = ['name', 'recent'] as const

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return { title: `Course · ${id.slice(0, 8)}` }
}

export default async function CoursePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  // Guard non-UUID segments (e.g. a stale /courses/new link) — the id column is
  // a uuid, so a bad value would throw at the DB instead of a clean 404.
  if (!isUuid(id)) notFound()
  const sp = await searchParams
  const recordParams = parsePrefixedListParams(sp, 'record', {
    sort: 'recent',
    perPage: 12,
    allowedSorts: RECORD_SORTS,
  })
  const classParams = parsePrefixedListParams(sp, 'class', {
    sort: 'upcoming',
    dir: 'asc',
    perPage: 12,
    allowedSorts: CLASS_SORTS,
  })
  const fileParams = parsePrefixedListParams(sp, 'file', {
    sort: 'name',
    dir: 'asc',
    perPage: 12,
    allowedSorts: FILE_SORTS,
  })
  const requestedRecordStatus = pickString(sp.recordStatus)
  const recordStatus =
    requestedRecordStatus === 'current' ||
    requestedRecordStatus === 'expired' ||
    requestedRecordStatus === 'no_expiry'
      ? requestedRecordStatus
      : undefined
  const requestedClassStatus = pickString(sp.classStatus)
  const classStatus =
    requestedClassStatus === 'scheduled' ||
    requestedClassStatus === 'completed' ||
    requestedClassStatus === 'cancelled'
      ? requestedClassStatus
      : undefined
  const requestedFileType = pickString(sp.fileType)
  const fileType =
    requestedFileType === 'document' ||
    requestedFileType === 'image' ||
    requestedFileType === 'video'
      ? requestedFileType
      : undefined
  const ctx = await requireModuleManage('training')

  const data = await ctx.db(async (tx) => {
    // The module/lesson tree, library content, quiz + assessment metadata, and
    // media URLs are loaded by the shared presentation loader (the same data the
    // classroom present route uses).
    const presentation = await loadCoursePresentation(tx, id)
    if (!presentation) return null

    const today = new Date().toISOString().slice(0, 10)
    const recordBase = and(
      eq(trainingRecords.courseId, id),
      isNotNull(trainingRecords.personId),
      isNull(trainingRecords.deletedAt),
    )
    const recordWhere = and(
      recordBase,
      recordParams.q
        ? or(
            ilike(people.firstName, `%${recordParams.q}%`),
            ilike(people.lastName, `%${recordParams.q}%`),
            ilike(people.employeeNo, `%${recordParams.q}%`),
          )
        : undefined,
      recordStatus === 'expired'
        ? sql`${trainingRecords.expiresOn} < ${today}`
        : recordStatus === 'current'
          ? sql`(${trainingRecords.expiresOn} is null or ${trainingRecords.expiresOn} >= ${today})`
          : recordStatus === 'no_expiry'
            ? isNull(trainingRecords.expiresOn)
            : undefined,
    )
    const classBase = eq(trainingClasses.courseId, id)
    const classWhere = and(
      classBase,
      classParams.q ? ilike(trainingClasses.title, `%${classParams.q}%`) : undefined,
      classStatus === 'scheduled'
        ? and(isNull(trainingClasses.cancelledAt), isNull(trainingClasses.completedAt))
        : classStatus === 'completed'
          ? and(isNotNull(trainingClasses.completedAt), isNull(trainingClasses.cancelledAt))
          : classStatus === 'cancelled'
            ? isNotNull(trainingClasses.cancelledAt)
            : undefined,
    )
    const fileBase = eq(trainingCourseFiles.courseId, id)
    const fileWhere = and(
      fileBase,
      fileParams.q
        ? or(
            ilike(trainingCourseFiles.label, `%${fileParams.q}%`),
            ilike(attachments.filename, `%${fileParams.q}%`),
          )
        : undefined,
      fileType === 'image'
        ? ilike(attachments.contentType, 'image/%')
        : fileType === 'video'
          ? ilike(attachments.contentType, 'video/%')
          : fileType === 'document'
            ? sql`(${attachments.contentType} is null or (${attachments.contentType} not ilike 'image/%' and ${attachments.contentType} not ilike 'video/%'))`
            : undefined,
    )

    const usedClassIds = [
      ...new Set(
        presentation.modules
          .flatMap((module) => module.lessons)
          .map((lesson) => lesson.classId)
          .filter((classId): classId is string => !!classId),
      ),
    ]
    const [
      recTotalRows,
      filteredRecRows,
      recs,
      classTotalRows,
      filteredClassRows,
      cls,
      classOptions,
      fileTotalRows,
      filteredFileRows,
      courseFiles,
    ] = await Promise.all([
      tx.select({ count: count() }).from(trainingRecords).where(recordBase),
      tx
        .select({ count: count() })
        .from(trainingRecords)
        .innerJoin(people, eq(people.id, trainingRecords.personId))
        .where(recordWhere),
      tx
        .select({ record: trainingRecords, person: people })
        .from(trainingRecords)
        .innerJoin(people, eq(people.id, trainingRecords.personId))
        .where(recordWhere)
        .orderBy(
          ...(recordParams.sort === 'name'
            ? [asc(people.lastName), asc(people.firstName)]
            : recordParams.sort === 'expiry'
              ? [asc(trainingRecords.expiresOn)]
              : [desc(trainingRecords.completedOn)]),
          desc(trainingRecords.id),
        )
        .limit(recordParams.perPage)
        .offset((recordParams.page - 1) * recordParams.perPage),
      tx.select({ count: count() }).from(trainingClasses).where(classBase),
      tx.select({ count: count() }).from(trainingClasses).where(classWhere),
      tx
        .select({
          id: trainingClasses.id,
          title: trainingClasses.title,
          startsAt: trainingClasses.startsAt,
        })
        .from(trainingClasses)
        .where(classWhere)
        .orderBy(
          classParams.sort === 'recent'
            ? desc(trainingClasses.startsAt)
            : asc(trainingClasses.startsAt),
          asc(trainingClasses.id),
        )
        .limit(classParams.perPage)
        .offset((classParams.page - 1) * classParams.perPage),
      usedClassIds.length
        ? tx
            .select({ id: trainingClasses.id, title: trainingClasses.title })
            .from(trainingClasses)
            .where(inArray(trainingClasses.id, usedClassIds))
        : Promise.resolve([]),
      tx.select({ count: count() }).from(trainingCourseFiles).where(fileBase),
      tx
        .select({ count: count() })
        .from(trainingCourseFiles)
        .leftJoin(attachments, eq(attachments.id, trainingCourseFiles.attachmentId))
        .where(fileWhere),
      tx
        .select({ file: trainingCourseFiles, att: attachments })
        .from(trainingCourseFiles)
        .leftJoin(attachments, eq(attachments.id, trainingCourseFiles.attachmentId))
        .where(fileWhere)
        .orderBy(
          fileParams.sort === 'recent'
            ? desc(trainingCourseFiles.createdAt)
            : asc(sql`coalesce(${trainingCourseFiles.label}, ${attachments.filename}, '')`),
          asc(trainingCourseFiles.id),
        )
        .limit(fileParams.perPage)
        .offset((fileParams.page - 1) * fileParams.perPage),
    ])

    const [tenant] = await tx
      .select({
        settings: tenants.settings,
      })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId!))
      .limit(1)
    const credentialOutputs = enabledCredentialOutputs(tenant?.settings).map((output) => ({
      id: output.id,
      name: output.name,
      format: output.format,
    }))

    return {
      presentation,
      cls,
      classOptions,
      classTotal: Number(classTotalRows[0]?.count ?? 0),
      filteredClassTotal: Number(filteredClassRows[0]?.count ?? 0),
      recs,
      recordTotal: Number(recTotalRows[0]?.count ?? 0),
      filteredRecordTotal: Number(filteredRecRows[0]?.count ?? 0),
      courseFiles,
      fileTotal: Number(fileTotalRows[0]?.count ?? 0),
      filteredFileTotal: Number(filteredFileRows[0]?.count ?? 0),
      credentialOutputs,
    }
  })

  if (!data) notFound()
  const {
    presentation,
    cls,
    classOptions,
    classTotal,
    filteredClassTotal,
    recs,
    recordTotal,
    filteredRecordTotal,
    courseFiles,
    fileTotal,
    filteredFileTotal,
    credentialOutputs,
  } = data
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
      assessmentTypes={Object.entries(presentation.assessmentMeta).map(([typeId, meta]) => ({
        id: typeId,
        name: meta.name,
      }))}
      classes={cls.map((c) => ({ id: c.id, title: c.title, startsAt: c.startsAt.toISOString() }))}
      classOptions={classOptions}
      classTotal={classTotal}
      filteredClassTotal={filteredClassTotal}
      classPage={classParams.page}
      classPerPage={classParams.perPage}
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
      recordsTotal={recordTotal}
      filteredRecordsTotal={filteredRecordTotal}
      recordPage={recordParams.page}
      recordPerPage={recordParams.perPage}
      files={courseFiles.map(({ file, att }) => ({
        id: file.id,
        label: file.label,
        filename: att?.filename ?? null,
        url: att?.r2Key ? attachmentUrl(att.id) : null,
        sizeBytes: att?.sizeBytes != null ? Number(att.sizeBytes) : null,
      }))}
      filesTotal={fileTotal}
      filteredFilesTotal={filteredFileTotal}
      filePage={fileParams.page}
      filePerPage={fileParams.perPage}
      currentParams={sp}
    />
  )
}
