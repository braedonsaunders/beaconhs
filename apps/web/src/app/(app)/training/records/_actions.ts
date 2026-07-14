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

import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  auditLog,
  people,
  trainingCertificates,
  trainingCourses,
  trainingRecords,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { materializeEvidenceTargetsObligations } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { csvRow } from '@/lib/csv'
import { addMonthsIso, isoToday } from '../_lib/dates'
import { newBulkActionBatchId, parseBulkActionIds } from '@/lib/bulk-actions'
import { requireUuidInput } from '@/lib/mutation-input'
import { MAX_TRAINING_VALIDITY_MONTHS } from '@/lib/training-mutation-validation'
import {
  assertTrainingRecordDateOrder,
  parseTrainingRecordFieldUpdate,
  parseTrainingRecordRevocationReason,
  type TrainingRecordFieldUpdate,
} from './_mutation-input'

type TrainingRecord = typeof trainingRecords.$inferSelect

async function materializeCourseEvidence(
  tx: Database,
  tenantId: string,
  courseIds: readonly (string | null)[],
): Promise<void> {
  await materializeEvidenceTargetsObligations(
    tx,
    tenantId,
    [...new Set(courseIds.filter((id): id is string => Boolean(id)))].map((courseId) => ({
      sourceModule: 'training' as const,
      targetRef: { courseId },
    })),
  )
}

function trainingRecordFieldValue(
  record: TrainingRecord,
  field: TrainingRecordFieldUpdate['field'],
): string | number | null {
  switch (field) {
    case 'personId':
      return record.personId
    case 'courseId':
      return record.courseId
    case 'source':
      return record.source
    case 'completedOn':
      return record.completedOn
    case 'expiresOn':
      return record.expiresOn
    case 'grade':
      return record.grade
    case 'instructor':
      return record.instructor
    case 'details':
      return record.details
    case 'notes':
      return record.notes
  }
}

async function updateTrainingRecordColumn(
  tx: Database,
  id: string,
  update: TrainingRecordFieldUpdate,
): Promise<{ id: string }[]> {
  const where = and(eq(trainingRecords.id, id), isNull(trainingRecords.deletedAt))
  switch (update.field) {
    case 'personId':
      return tx
        .update(trainingRecords)
        .set({ personId: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
    case 'courseId':
      return tx
        .update(trainingRecords)
        .set({ courseId: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
    case 'source':
      return tx
        .update(trainingRecords)
        .set({ source: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
    case 'completedOn':
      return tx
        .update(trainingRecords)
        .set({ completedOn: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
    case 'expiresOn':
      return tx
        .update(trainingRecords)
        .set({ expiresOn: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
    case 'grade':
      return tx
        .update(trainingRecords)
        .set({ grade: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
    case 'instructor':
      return tx
        .update(trainingRecords)
        .set({ instructor: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
    case 'details':
      return tx
        .update(trainingRecords)
        .set({ details: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
    case 'notes':
      return tx
        .update(trainingRecords)
        .set({ notes: update.value })
        .where(where)
        .returning({ id: trainingRecords.id })
  }
}

function expiryForValidity(completedOn: string, validForMonths: number | null): string | null {
  if (validForMonths == null || validForMonths === 0) return null
  if (
    !Number.isSafeInteger(validForMonths) ||
    validForMonths < 0 ||
    validForMonths > MAX_TRAINING_VALIDITY_MONTHS
  ) {
    throw new Error('Course validity is invalid; correct the course before renewing records.')
  }
  return addMonthsIso(completedOn, validForMonths)
}

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
    if (!row) throw new Error('Could not create the certificate.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      entityId: row.id,
      action: 'create',
      summary: 'Created certificate draft',
    })
    return row.id
  })
  revalidatePath('/training/records')
  redirect(`/training/records/${newId}`)
}

// Per-field auto-save for the shared Live* field set — the unified create/edit/
// view surface (mirrors the class / incident / hazard-assessment detail pages).
// Identity (person/course) and lifecycle fields are editable; revoked records
// are locked.
export async function updateTrainingRecordField(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.record.create')
  const id = requireUuidInput(formData.get('id'), 'Training record')
  const update = parseTrainingRecordFieldUpdate(formData.get('field'), formData.get('value'))

  const changed = await ctx.db(async (tx) => {
    const [record] = await tx
      .select()
      .from(trainingRecords)
      .where(eq(trainingRecords.id, id))
      .for('update')
      .limit(1)
    if (!record) throw new Error('Training record not found.')
    if (record.deletedAt) throw new Error('Revoked training records cannot be edited.')

    if (update.field === 'personId' && update.value !== record.personId) {
      const [person] = await tx
        .select({ id: people.id })
        .from(people)
        .where(
          and(eq(people.id, update.value), eq(people.status, 'active'), isNull(people.deletedAt)),
        )
        .limit(1)
      if (!person) throw new Error('The selected person is not active in this workspace.')
    }
    if (update.field === 'courseId' && update.value !== record.courseId) {
      const [course] = await tx
        .select({ id: trainingCourses.id })
        .from(trainingCourses)
        .where(and(eq(trainingCourses.id, update.value), isNull(trainingCourses.deletedAt)))
        .limit(1)
      if (!course) throw new Error('The selected course is not available in this workspace.')
    }

    if (update.field === 'completedOn') {
      assertTrainingRecordDateOrder(update.value, record.expiresOn)
    } else if (update.field === 'expiresOn') {
      assertTrainingRecordDateOrder(record.completedOn, update.value)
    }

    const previous = trainingRecordFieldValue(record, update.field)
    if (previous === update.value) return false

    const [updated] = await updateTrainingRecordColumn(tx, id, update)
    if (!updated) throw new Error('Training record could not be updated.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      entityId: id,
      action: 'update',
      summary: `Updated ${update.field}`,
      before: { [update.field]: previous },
      after: { [update.field]: update.value },
    })
    if (
      update.field === 'personId' ||
      update.field === 'courseId' ||
      update.field === 'completedOn' ||
      update.field === 'expiresOn'
    ) {
      await materializeCourseEvidence(tx, ctx.tenantId, [
        record.courseId,
        update.field === 'courseId' ? update.value : record.courseId,
      ])
    }
    return true
  })
  if (!changed) return
  revalidatePath(`/training/records/${id}`)
  revalidatePath('/training/records')
}

/**
 * Mint one direct replacement for a completed record. The source-row lock plus
 * audit deduplication makes retries idempotent; a later renewal starts from the
 * replacement instead of creating sibling credentials from one history row.
 */
export async function renewTrainingRecord(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.record.create')
  const id = requireUuidInput(formData.get('id'), 'Training record')
  const dedupKey = `training-record-renew:${id}`

  const newId = await ctx.db(async (tx) => {
    const [record] = await tx
      .select()
      .from(trainingRecords)
      .where(eq(trainingRecords.id, id))
      .for('update')
      .limit(1)
    if (!record) throw new Error('Training record not found.')
    if (!record.personId || !record.courseId) {
      throw new Error('Choose a person and course before renewing this record.')
    }

    const [previousRenewal] = await tx
      .select({ entityId: auditLog.entityId })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, ctx.tenantId), eq(auditLog.dedupKey, dedupKey)))
      .limit(1)
    if (previousRenewal) {
      if (!previousRenewal.entityId) {
        throw new Error('The recorded renewal is incomplete. Contact a platform administrator.')
      }
      const [replacement] = await tx
        .select({ id: trainingRecords.id })
        .from(trainingRecords)
        .where(eq(trainingRecords.id, previousRenewal.entityId))
        .limit(1)
      if (!replacement) {
        throw new Error('The recorded renewal is missing. Contact a platform administrator.')
      }
      return replacement.id
    }

    const [person] = await tx
      .select({ id: people.id })
      .from(people)
      .where(
        and(eq(people.id, record.personId), eq(people.status, 'active'), isNull(people.deletedAt)),
      )
      .limit(1)
    if (!person) throw new Error('Only an active person can receive a renewed record.')
    const [course] = await tx
      .select({ validForMonths: trainingCourses.validForMonths })
      .from(trainingCourses)
      .where(and(eq(trainingCourses.id, record.courseId), isNull(trainingCourses.deletedAt)))
      .for('update')
      .limit(1)
    if (!course) throw new Error('The course is no longer available.')

    const completedOn = isoToday()
    const expiresOn = expiryForValidity(completedOn, course.validForMonths)
    const [created] = await tx
      .insert(trainingRecords)
      .values({
        tenantId: ctx.tenantId,
        personId: record.personId,
        courseId: record.courseId,
        source: 'external_upload',
        completedOn,
        expiresOn,
        instructor: record.instructor,
        issuedByTenantUserId: ctx.membership?.id ?? null,
      })
      .returning({ id: trainingRecords.id })
    if (!created) throw new Error('Could not create the renewed training record.')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      entityId: created.id,
      action: 'create',
      summary: 'Record renewed (created replacement)',
      after: { previousRecordId: id, completedOn, expiresOn },
      dedupKey,
    })
    await materializeCourseEvidence(tx, ctx.tenantId, [record.courseId])
    return created.id
  })

  revalidatePath(`/training/records/${id}`)
  revalidatePath('/training/records')
  revalidatePath('/training')
  redirect(`/training/records/${newId}`)
}

export async function revokeTrainingRecord(formData: FormData): Promise<void> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'training.record.create')
  const id = requireUuidInput(formData.get('id'), 'Training record')
  const reason = parseTrainingRecordRevocationReason(formData.get('reason'))

  const changed = await ctx.db(async (tx) => {
    const [record] = await tx
      .select({
        id: trainingRecords.id,
        courseId: trainingRecords.courseId,
        deletedAt: trainingRecords.deletedAt,
      })
      .from(trainingRecords)
      .where(eq(trainingRecords.id, id))
      .for('update')
      .limit(1)
    if (!record) throw new Error('Training record not found.')
    if (record.deletedAt) return false

    const revokedAt = new Date()
    const [revoked] = await tx
      .update(trainingRecords)
      .set({ deletedAt: revokedAt })
      .where(and(eq(trainingRecords.id, id), isNull(trainingRecords.deletedAt)))
      .returning({ id: trainingRecords.id })
    if (!revoked) throw new Error('Training record could not be revoked.')
    await tx
      .update(trainingCertificates)
      .set({ revokedAt, revokedReason: reason })
      .where(and(eq(trainingCertificates.recordId, id), isNull(trainingCertificates.revokedAt)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      entityId: id,
      action: 'delete',
      summary: 'Record revoked',
      before: { deletedAt: null },
      after: { deletedAt: revokedAt },
      metadata: { reason },
    })
    await materializeCourseEvidence(tx, ctx.tenantId, [record.courseId])
    return true
  })
  if (!changed) return

  revalidatePath(`/training/records/${id}`)
  revalidatePath('/training/records')
  revalidatePath('/training')
}

type BulkActionResult =
  { ok: true; updated: number; skipped: number } | { ok: false; error: string }

type BulkCsvResult = { ok: true; filename: string; content: string } | { ok: false; error: string }

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
  const parsedIds = parseBulkActionIds(args?.recordIds, {
    singular: 'training record',
    plural: 'training records',
  })
  if (!parsedIds.ok) return parsedIds
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()
  const today = isoToday()
  const issuedByTenantUserId = ctx.membership?.id ?? null

  const result = await ctx.db(async (tx) => {
    const records = await tx
      .select()
      .from(trainingRecords)
      .where(and(inArray(trainingRecords.id, ids), isNull(trainingRecords.deletedAt)))
      .orderBy(asc(trainingRecords.id))
      .for('update')
    const courseIds = [
      ...new Set(records.flatMap((record) => (record.courseId ? [record.courseId] : []))),
    ]
    const courses = courseIds.length
      ? await tx
          .select({
            id: trainingCourses.id,
            validForMonths: trainingCourses.validForMonths,
          })
          .from(trainingCourses)
          .where(and(inArray(trainingCourses.id, courseIds), isNull(trainingCourses.deletedAt)))
          .orderBy(asc(trainingCourses.id))
          .for('update')
      : []
    const coursesById = new Map(courses.map((course) => [course.id, course]))
    const eligible = records.flatMap((record) => {
      if (!record.personId || !record.courseId) return []
      const course = coursesById.get(record.courseId)
      return course ? [{ record, course }] : []
    })
    const skipped = ids.length - eligible.length
    if (eligible.length === 0) return { updated: 0, skipped }

    const renewals = eligible.map(({ record, course }) => ({
      sourceId: record.id,
      insert: {
        id: randomUUID(),
        tenantId: ctx.tenantId,
        personId: record.personId,
        courseId: record.courseId,
        source: 'external_upload' as const,
        classId: null,
        score: record.score,
        grade: record.grade,
        completedOn: today,
        expiresOn: expiryForValidity(today, course.validForMonths),
        instructor: record.instructor,
        evaluatorPersonId: record.evaluatorPersonId,
        certificateType: null,
        certificateAttachmentId: null,
        issuedByTenantUserId,
        details: 'Bulk renewal',
        notes: `Renewed from record ${record.id}`,
      },
    }))

    const newRows = await tx
      .insert(trainingRecords)
      .values(renewals.map((renewal) => renewal.insert))
      .returning({ id: trainingRecords.id })
    if (newRows.length !== renewals.length) {
      throw new Error('Not every selected training record could be renewed.')
    }

    for (const renewal of renewals) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_record',
        entityId: renewal.sourceId,
        action: 'copy',
        summary: 'Bulk action: renewed into a new record',
        metadata: { batchId, newRecordId: renewal.insert.id },
      })
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_record',
        entityId: renewal.insert.id,
        action: 'create',
        summary: 'Bulk action: created as renewal',
        metadata: { batchId, renewedFromRecordId: renewal.sourceId },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      action: 'create',
      summary: `Bulk renewed ${renewals.length} training record${renewals.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        sourceRecordIds: renewals.map((renewal) => renewal.sourceId),
        newRecordIds: renewals.map((renewal) => renewal.insert.id),
        skipped,
      },
    })
    await materializeCourseEvidence(
      tx,
      ctx.tenantId,
      renewals.map((renewal) => renewal.insert.courseId),
    )

    return {
      updated: renewals.length,
      skipped,
    }
  })

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
  const parsedIds = parseBulkActionIds(args?.recordIds, {
    singular: 'training record',
    plural: 'training records',
  })
  if (!parsedIds.ok) return parsedIds
  const reasonValue = args?.reason
  if (reasonValue !== undefined && reasonValue !== null && typeof reasonValue !== 'string') {
    return { ok: false, error: 'The revocation reason is invalid.' }
  }
  const reason = reasonValue?.trim() || null
  if (reason && reason.length > 1_000) {
    return { ok: false, error: 'The revocation reason must be 1,000 characters or fewer.' }
  }
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const result = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        id: trainingRecords.id,
        courseId: trainingRecords.courseId,
        deletedAt: trainingRecords.deletedAt,
      })
      .from(trainingRecords)
      .where(inArray(trainingRecords.id, ids))
      .orderBy(asc(trainingRecords.id))
      .for('update')
    const editable = rows.filter((r) => r.deletedAt === null).map((r) => r.id)
    const skipped = ids.length - editable.length
    if (editable.length === 0) return { updated: 0, skipped }
    const revokedAt = new Date()
    const revoked = await tx
      .update(trainingRecords)
      .set({ deletedAt: revokedAt })
      .where(and(inArray(trainingRecords.id, editable), isNull(trainingRecords.deletedAt)))
      .returning({ id: trainingRecords.id })
    if (revoked.length !== editable.length) {
      throw new Error('Not every selected training record could be revoked.')
    }
    await tx
      .update(trainingCertificates)
      .set({ revokedAt, revokedReason: reason })
      .where(
        and(
          inArray(trainingCertificates.recordId, editable),
          isNull(trainingCertificates.revokedAt),
        ),
      )

    for (const id of editable) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_record',
        entityId: id,
        action: 'delete',
        summary: 'Bulk action: revoked',
        metadata: { batchId, reason },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      action: 'delete',
      summary: `Bulk revoked ${editable.length} training record${editable.length === 1 ? '' : 's'}`,
      metadata: {
        batchId,
        recordIds: editable,
        reason,
        skipped,
      },
    })
    await materializeCourseEvidence(
      tx,
      ctx.tenantId,
      rows.filter((row) => editable.includes(row.id)).map((row) => row.courseId),
    )
    return { updated: editable.length, skipped }
  })

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
  const parsedIds = parseBulkActionIds(args?.recordIds, {
    singular: 'training record',
    plural: 'training records',
  })
  if (!parsedIds.ok) return parsedIds
  const ids = parsedIds.ids
  const batchId = newBulkActionBatchId()

  const selected = await ctx.db(async (tx) => {
    const rows = await tx
      .select({
        record: trainingRecords,
        person: people,
        course: trainingCourses,
      })
      .from(trainingRecords)
      .innerJoin(people, eq(people.id, trainingRecords.personId))
      .innerJoin(trainingCourses, eq(trainingCourses.id, trainingRecords.courseId))
      .where(and(inArray(trainingRecords.id, ids), isNull(trainingRecords.deletedAt)))
      .orderBy(asc(people.lastName), asc(trainingCourses.code))
    if (rows.length !== ids.length) {
      return {
        ok: false as const,
        error: 'One or more selected training records are no longer available. Refresh and retry.',
      }
    }

    for (const { record } of rows) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'training_record',
        entityId: record.id,
        action: 'export',
        summary: 'Bulk action: exported to CSV',
        metadata: { batchId },
      })
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'training_record',
      action: 'export',
      summary: `Bulk exported ${rows.length} training record${rows.length === 1 ? '' : 's'} to CSV`,
      metadata: {
        batchId,
        recordIds: rows.map((row) => row.record.id),
        format: 'csv',
      },
    })
    return { ok: true as const, rows }
  })
  if (!selected.ok) return selected
  const rows = selected.rows

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

  return { ok: true, filename, content }
}
