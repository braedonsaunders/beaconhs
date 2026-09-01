import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'
import { people, trainingCourses, trainingRecords } from '@beaconhs/db/schema'
import {
  MAX_REPORT_WALLET_CARDS,
  parseWalletCardPersonName,
  walletCardLookupsFromResult,
  type ReportRunResult,
} from '@beaconhs/reports'
import { can, type RequestContext } from '@beaconhs/tenant'
import { issueTrainingCertificate } from './training-certificate-issuance'
import { renderTrainingWalletCardBatchPdf } from './training-credentials'

function canSeeTrainingRecord(ctx: RequestContext, personId: string): boolean {
  if (ctx.isSuperAdmin || can(ctx, 'training.read.all')) return true
  return Boolean(ctx.personId && ctx.personId === personId)
}

export async function renderWalletCardsForReport(
  ctx: RequestContext,
  result: ReportRunResult,
): Promise<
  | { ok: true; bytes: Buffer; filename: string; rendered: number; skipped: number }
  | { ok: false; error: string; status: number }
> {
  if (!can(ctx, 'training.read.all') && !can(ctx, 'training.read.self')) {
    return { ok: false, error: 'Not authorized.', status: 403 }
  }
  const lookups = walletCardLookupsFromResult(result)
  if (lookups.length === 0) {
    return {
      ok: false,
      error:
        'This report needs people and courses (employee # and course code, or person and course names) before wallet cards can print.',
      status: 409,
    }
  }
  if (lookups.length > MAX_REPORT_WALLET_CARDS) {
    return {
      ok: false,
      error: `Print no more than ${MAX_REPORT_WALLET_CARDS} wallet cards in one report run.`,
      status: 400,
    }
  }

  const employeeNos = [...new Set(lookups.map((item) => item.employeeNo).filter(Boolean))]
  const courseCodes = [...new Set(lookups.map((item) => item.courseCode).filter(Boolean))]
  const courseNames = [...new Set(lookups.map((item) => item.courseName).filter(Boolean))]
  const lastNames = [
    ...new Set(
      lookups
        .map((item) => parseWalletCardPersonName(item.personName)?.lastName)
        .filter((value): value is string => Boolean(value)),
    ),
  ]

  const personMatch = or(
    employeeNos.length ? inArray(people.employeeNo, employeeNos) : undefined,
    lastNames.length ? inArray(people.lastName, lastNames) : undefined,
  )
  const courseMatch = or(
    courseCodes.length ? inArray(trainingCourses.code, courseCodes) : undefined,
    courseNames.length ? inArray(trainingCourses.name, courseNames) : undefined,
  )
  if (!personMatch || !courseMatch) {
    return {
      ok: false,
      error:
        'This report needs people and courses (employee # and course code, or person and course names) before wallet cards can print.',
      status: 409,
    }
  }

  const [personRows, courseRows] = await ctx.db((tx) =>
    Promise.all([
      tx
        .select({
          id: people.id,
          employeeNo: people.employeeNo,
          firstName: people.firstName,
          lastName: people.lastName,
        })
        .from(people)
        .where(and(isNull(people.deletedAt), personMatch)),
      tx
        .select({ id: trainingCourses.id, code: trainingCourses.code, name: trainingCourses.name })
        .from(trainingCourses)
        .where(and(isNull(trainingCourses.deletedAt), courseMatch)),
    ]),
  )

  const personByEmployee = new Map(
    personRows.flatMap((row) => (row.employeeNo ? [[row.employeeNo, row.id] as const] : [])),
  )
  const personByName = new Map(
    personRows.map((row) => [`${row.lastName}, ${row.firstName}`.toLowerCase(), row.id]),
  )
  const courseByCode = new Map(courseRows.map((row) => [row.code, row.id]))
  const courseByName = new Map(courseRows.map((row) => [row.name, row.id]))

  const pairs = lookups.flatMap((item) => {
    const personId =
      (item.employeeNo ? personByEmployee.get(item.employeeNo) : undefined) ??
      personByName.get(item.personName.toLowerCase())
    const courseId =
      (item.courseCode ? courseByCode.get(item.courseCode) : undefined) ??
      courseByName.get(item.courseName)
    return personId && courseId ? [{ personId, courseId }] : []
  })
  if (pairs.length === 0) {
    return {
      ok: false,
      error: 'None of the matching people have a certificate to print.',
      status: 409,
    }
  }

  const personIds = [...new Set(pairs.map((pair) => pair.personId))]
  const records = await ctx.db((tx) =>
    tx
      .select({
        id: trainingRecords.id,
        personId: trainingRecords.personId,
        courseId: trainingRecords.courseId,
      })
      .from(trainingRecords)
      .where(and(inArray(trainingRecords.personId, personIds), isNull(trainingRecords.deletedAt)))
      .orderBy(desc(trainingRecords.completedOn), desc(trainingRecords.id)),
  )
  const latest = new Map<string, string>()
  for (const record of records) {
    const key = `${record.personId}:${record.courseId}`
    if (!latest.has(key)) latest.set(key, record.id)
  }

  const recordIds = pairs
    .map((pair) => latest.get(`${pair.personId}:${pair.courseId}`))
    .filter((id): id is string => Boolean(id))
  if (recordIds.length === 0) {
    return {
      ok: false,
      error: 'None of the matching people have a certificate to print.',
      status: 409,
    }
  }

  const certificateIds: string[] = []
  let skipped = lookups.length - recordIds.length
  for (const recordId of recordIds) {
    const certificate = await ctx.db(async (tx) => {
      const [record] = await tx
        .select({ personId: trainingRecords.personId, deletedAt: trainingRecords.deletedAt })
        .from(trainingRecords)
        .where(eq(trainingRecords.id, recordId))
        .limit(1)
      if (
        !record ||
        record.deletedAt ||
        !record.personId ||
        !canSeeTrainingRecord(ctx, record.personId)
      ) {
        return null
      }
      const issued = await issueTrainingCertificate(tx, {
        tenantId: ctx.tenantId!,
        recordId,
      })
      return issued.revokedAt ? null : issued.id
    })
    if (!certificate) {
      skipped += 1
      continue
    }
    certificateIds.push(certificate)
  }
  if (certificateIds.length === 0) {
    return {
      ok: false,
      error: 'None of the matching records has an available wallet card.',
      status: 409,
    }
  }

  const rendered = await renderTrainingWalletCardBatchPdf(ctx, certificateIds)
  if (!rendered) {
    return {
      ok: false,
      error: 'The selected courses do not have an enabled wallet-card design.',
      status: 409,
    }
  }
  return {
    ok: true,
    bytes: rendered.bytes,
    filename: rendered.filename,
    rendered: rendered.rendered,
    skipped: skipped + rendered.skipped,
  }
}
