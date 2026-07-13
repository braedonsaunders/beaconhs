'use server'

// Bulk-action server actions for /training/records.
//
// Three actions surface in the floating bulk-action bar:
//   - bulkRenewTrainingRecords    for each row, create a NEW training_records
//                                  row (same person+course, completedOn=today,
//                                  expiresOn auto-computed from
//                                  course.validForMonths)
//   - bulkRevokeTrainingRecords   soft-delete (set deletedAt=now). The
//                                  training_records table has softDelete but
//                                  no "revoked" status enum — revoking is
//                                  modelled as a soft-delete + audit entry
//                                  with action='delete'.
//   - bulkExportTrainingRecordsCsv  download just the checked rows

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { people, trainingCourses, trainingRecords } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { csvRow } from '@/lib/csv'
import { addMonthsIso, isoToday } from '../_lib/dates'

const RECORD_SOURCES = ['class', 'self_paced', 'evaluator', 'external_upload', 'migrated'] as const

// "New certificate" — creates a BLANK draft (no person/course) and redirects
// straight to its unified record page, where every field is filled in inline.
// No intermediate form, and nothing is pre-selected so a fresh draft never looks
// like a pre-existing record. Mirrors how hazard assessments start. Lists/reports
// hide drafts until both person + course are set.
export async function startTrainingRecord(): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.record.create')

  const newId = await ctx.db(async (tx) => {
    const [row] = await tx
      .insert(trainingRecords)
      .values({
        tenantId: ctx.tenantId,
        source: 'external_upload',
        completedOn: isoToday(),
        issuedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: trainingRecords.id })
    return row?.id ?? null
  })
  if (!newId) throw new Error('Could not create the certificate.')

  await recordAudit(ctx, {
    entityType: 'training_record',
    entityId: newId,
    action: 'create',
    summary: 'Created certificate draft',
  })
  revalidatePath('/training/records')
  redirect(`/training/records/${newId}`)
}

const RECORD_REQUIRED_IDS = new Set(['personId', 'courseId'])
const RECORD_DATE_NOTNULL = new Set(['completedOn'])
const RECORD_DATE_NULL = new Set(['expiresOn'])
const RECORD_INT_NULL = new Set(['grade'])
const RECORD_TEXT_NULL = new Set(['instructor', 'details', 'notes'])

// Per-field auto-save for the shared Live* field set — the unified create/edit/
// view surface (mirrors the class / incident / hazard-assessment detail pages).
// Identity (person/course) and lifecycle fields are editable; revoked records
// are locked.
export async function updateTrainingRecordField(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.record.create')
  const id = String(formData.get('id') ?? '')
  const field = String(formData.get('field') ?? '')
  const raw = formData.get('value')
  const value = typeof raw === 'string' ? raw : ''
  if (!id || !field) throw new Error('Missing id/field')

  const allowed =
    RECORD_REQUIRED_IDS.has(field) ||
    RECORD_DATE_NOTNULL.has(field) ||
    RECORD_DATE_NULL.has(field) ||
    RECORD_INT_NULL.has(field) ||
    RECORD_TEXT_NULL.has(field) ||
    field === 'source'
  if (!allowed) throw new Error('Field not allowed')

  const before = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ deletedAt: trainingRecords.deletedAt })
      .from(trainingRecords)
      .where(eq(trainingRecords.id, id))
      .limit(1)
    return row ?? null
  })
  if (!before) throw new Error('Record not found')
  if (before.deletedAt) throw new Error('Record is revoked')

  let val: unknown
  if (RECORD_REQUIRED_IDS.has(field)) {
    // Draft-friendly: a blank person/course is a valid in-progress state, so an
    // empty save is a silent no-op rather than a "required" error.
    if (!value) return
    val = value
  } else if (field === 'source') {
    if (!(RECORD_SOURCES as readonly string[]).includes(value)) throw new Error('Invalid source')
    val = value
  } else if (RECORD_DATE_NOTNULL.has(field)) {
    if (!value) return // draft-friendly: keep the existing date rather than erroring
    if (Number.isNaN(new Date(value).getTime())) throw new Error('A valid date is required')
    val = value
  } else if (RECORD_DATE_NULL.has(field)) {
    if (value.trim() === '') val = null
    else {
      if (Number.isNaN(new Date(value).getTime())) throw new Error('Invalid date')
      val = value
    }
  } else if (RECORD_INT_NULL.has(field)) {
    if (value.trim() === '') val = null
    else {
      const n = Number.parseInt(value, 10)
      if (Number.isNaN(n)) throw new Error('Invalid number')
      val = Math.max(0, Math.min(100, n))
    }
  } else {
    val = value.trim() === '' ? null : value.trim()
  }

  await ctx.db((tx) =>
    tx
      .update(trainingRecords)
      .set({ [field]: val } as any)
      .where(eq(trainingRecords.id, id)),
  )
  await recordAudit(ctx, {
    entityType: 'training_record',
    entityId: id,
    action: 'update',
    summary: `Updated ${field}`,
    after: { [field]: val },
  })
  revalidatePath(`/training/records/${id}`)
  revalidatePath('/training/records')
}

type BulkActionResult =
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: string }

type BulkCsvResult = { ok: true; filename: string; content: string } | { ok: false; error: string }

const MAX_BULK = 500

function makeBatchId(): string {
  return `bat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * For each selected record, mint a NEW training_records row (same person +
 * course) with completedOn=today and expiresOn auto-computed from
 * course.validForMonths (null = no expiry). The originating row is left
 * untouched — that's why this is "renew", not "extend".
 */
export async function bulkRenewTrainingRecords(args: {
  recordIds: string[]
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  // Server actions are POST endpoints — gate the mutation here, not just in the
  // list UI. Renewing mints new training_records rows → training.record.create.
  assertCan(ctx, 'training.record.create')
  if (args.recordIds.length === 0) return { ok: false, error: 'No records selected.' }
  const ids = args.recordIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()
  const today = isoToday()
  const issuedByTenantUserId = ctx.membership?.id ?? null

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        record: trainingRecords,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(and(inArray(trainingRecords.id, ids), isNull(trainingRecords.deletedAt)))
    const skipped = ids.length - rows.length
    if (rows.length === 0) return { updated: 0, skipped }

    const inserts = rows.map(({ record, course }) => ({
      tenantId: ctx.tenantId,
      personId: record.personId,
      courseId: record.courseId,
      source: 'external_upload' as const,
      classId: null,
      score: record.score,
      grade: record.grade,
      completedOn: today,
      expiresOn: course.validForMonths ? addMonthsIso(today, course.validForMonths) : null,
      instructor: record.instructor,
      evaluatorPersonId: record.evaluatorPersonId,
      certificateType: null,
      certificateAttachmentId: null,
      issuedByTenantUserId,
      details: 'Bulk renewal',
      notes: `Renewed from record ${record.id}`,
    }))

    const newRows = await tx
      .insert(trainingRecords)
      .values(inserts)
      .returning({ id: trainingRecords.id, personId: trainingRecords.personId })

    return {
      updated: newRows.length,
      skipped,
      sourceIds: rows.map((r) => r.record.id),
      newIds: newRows.map((r) => r.id),
    }
  })

  if ('sourceIds' in result && result.sourceIds) {
    for (let i = 0; i < result.sourceIds.length; i += 1) {
      const sourceId = result.sourceIds[i]!
      const newId = result.newIds?.[i] ?? null
      await recordAudit(ctx, {
        entityType: 'training_record',
        entityId: sourceId,
        action: 'update',
        summary: 'Bulk action: renewed (new record created)',
        metadata: { batchId, newRecordId: newId },
      })
      if (newId) {
        await recordAudit(ctx, {
          entityType: 'training_record',
          entityId: newId,
          action: 'create',
          summary: 'Bulk action: created as renewal',
          metadata: { batchId, renewedFromRecordId: sourceId },
        })
      }
    }
    await recordAudit(ctx, {
      entityType: 'training_record',
      action: 'create',
      summary: `Bulk renewed ${result.sourceIds.length} training record${result.sourceIds.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        sourceRecordIds: result.sourceIds,
        newRecordIds: result.newIds ?? [],
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/training/records')
  revalidatePath('/training')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

/**
 * Revoke a batch of training records. The schema has no `status` enum on
 * training_records — softDelete is the equivalent: the record stops counting
 * toward the matrix / reports the moment its deletedAt is set.
 */
export async function bulkRevokeTrainingRecords(args: {
  recordIds: string[]
  reason?: string | null
}): Promise<BulkActionResult> {
  const ctx = await requireRequestContext()
  // Revoking soft-deletes training_records — same write privilege as renew.
  assertCan(ctx, 'training.record.create')
  if (args.recordIds.length === 0) return { ok: false, error: 'No records selected.' }
  const ids = args.recordIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({ id: trainingRecords.id, deletedAt: trainingRecords.deletedAt })
      .from(trainingRecords)
      .where(inArray(trainingRecords.id, ids))
    const editable = rows.filter((r) => r.deletedAt === null).map((r) => r.id)
    const skipped = rows.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    await tx
      .update(trainingRecords)
      .set({ deletedAt: new Date() })
      .where(inArray(trainingRecords.id, editable))
    return { updated: editable.length, skipped, editable }
  })

  if ('editable' in result && result.editable) {
    for (const id of result.editable) {
      await recordAudit(ctx, {
        entityType: 'training_record',
        entityId: id,
        action: 'delete',
        summary: 'Bulk action: revoked',
        metadata: { batchId, reason: args.reason ?? null },
      })
    }
    await recordAudit(ctx, {
      entityType: 'training_record',
      action: 'delete',
      summary: `Bulk revoked ${result.editable.length} training record${result.editable.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        recordIds: result.editable,
        reason: args.reason ?? null,
        skipped: result.skipped,
      },
    })
  }

  revalidatePath('/training/records')
  revalidatePath('/training')
  return { ok: true, updated: result.updated, skipped: result.skipped }
}

export async function bulkExportTrainingRecordsCsv(args: {
  recordIds: string[]
}): Promise<BulkCsvResult> {
  const ctx = await requireRequestContext()
  // Bulk export takes caller-supplied ids and is not otherwise scoped, so a
  // self-only viewer could exfiltrate anyone's records. Restrict to all-viewers
  // (training.read.all / super-admin); the list UI hides Export for everyone else.
  assertCan(ctx, 'training.read.all')
  if (args.recordIds.length === 0) return { ok: false, error: 'No records selected.' }
  const ids = args.recordIds.slice(0, MAX_BULK)
  const batchId = makeBatchId()

  const rows = await ctx.db((tx) =>
    tx
      .select({
        record: trainingRecords,
        person: people,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(inArray(trainingRecords.id, ids))
      .orderBy(asc(people.lastName), asc(trainingCourses.code)),
  )

  const headers = [
    'Last name',
    'First name',
    'Employee #',
    'Course code',
    'Course name',
    'Completed on',
    'Expires on',
    'Source',
    'Score',
    'Grade',
  ]
  const csvLines = [csvRow(headers)]
  for (const { record, person, course } of rows) {
    csvLines.push(
      csvRow([
        person.lastName,
        person.firstName,
        person.employeeNo ?? '',
        course.code,
        course.name,
        record.completedOn ?? '',
        record.expiresOn ?? '',
        record.source,
        record.score ?? '',
        record.grade ?? '',
      ]),
    )
  }
  const content = csvLines.join('\r\n') + '\r\n'
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const filename = `training-records-selected-${stamp}.csv`

  for (const { record } of rows) {
    await recordAudit(ctx, {
      entityType: 'training_record',
      entityId: record.id,
      action: 'export',
      summary: 'Bulk action: exported to CSV',
      metadata: { batchId },
    })
  }
  await recordAudit(ctx, {
    entityType: 'training_record',
    action: 'export',
    summary: `Bulk exported ${rows.length} training record${rows.length === 1 ? '' : 's'} to CSV`,
    metadata: {
      batchId,
      recordIds: rows.map((r) => r.record.id),
      format: 'csv',
    },
  })

  return { ok: true, filename, content }
}
