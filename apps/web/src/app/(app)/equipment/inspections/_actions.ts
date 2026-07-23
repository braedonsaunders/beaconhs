'use server'

// Runtime actions for performing an equipment inspection. Every mutation
// locks the tenant-scoped parent record first, then validates and writes its
// child rows in that same transaction. This makes autosave, submit, and reopen
// serialize on one lifecycle lock instead of racing across separate requests.

import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import {
  attachments,
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionTypes,
  equipmentItems,
} from '@beaconhs/db/schema'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { validateTenantImageAttachmentIdsInTx } from '@/lib/attachment-validation'
import { materializeEquipmentTypeEvidence } from '@/lib/compliance-type-evidence'
import { parseDatetimeLocal } from '@/lib/datetime'
import { formatInterval } from '@/lib/equipment/intervals'
import {
  normalizeInspectionNumberAnswer,
  normalizeInspectionTextAnswer,
} from '@/lib/inspection-response-config'
import { isUuid } from '@/lib/list-params'
import { parsePhotoEdits } from '@/lib/photo-edits'
import { canSeeRecord } from '@/lib/visibility'
import {
  finaliseEquipmentInspection,
  lockVisibleEquipmentInspectionForMutation,
  materialiseEquipmentCriteriaInTx,
  nextEquipmentInspectionReferenceInTx,
  parseEqAnswer,
  parseEqSeverity,
  type EquipmentInspectionTx,
} from './_lib'

function revalidateRecord(id: string) {
  revalidatePath(`/equipment/inspections/${id}`)
  revalidatePath('/equipment/inspections')
  revalidatePath('/equipment/maintenance')
}

async function criterionForMutationInTx(
  tx: EquipmentInspectionTx,
  tenantId: string,
  recordId: string,
  rowId: string,
) {
  const [criterion] = await tx
    .select()
    .from(equipmentInspectionRecordCriteria)
    .where(
      and(
        eq(equipmentInspectionRecordCriteria.tenantId, tenantId),
        eq(equipmentInspectionRecordCriteria.recordId, recordId),
        eq(equipmentInspectionRecordCriteria.id, rowId),
      ),
    )
    .limit(1)
  if (!criterion) throw new Error('Equipment inspection item not found')
  return criterion
}

async function markEquipmentInspectionInProgressIfDraft(
  tx: EquipmentInspectionTx,
  ctx: RequestContext,
  record: typeof equipmentInspectionRecords.$inferSelect,
): Promise<void> {
  if (record.status !== 'draft') return
  const [updated] = await tx
    .update(equipmentInspectionRecords)
    .set({ status: 'in_progress' })
    .where(
      and(
        eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
        eq(equipmentInspectionRecords.id, record.id),
        eq(equipmentInspectionRecords.status, 'draft'),
        isNull(equipmentInspectionRecords.deletedAt),
      ),
    )
    .returning({ id: equipmentInspectionRecords.id })
  if (!updated) throw new Error('Equipment inspection changed before work could begin')
  await recordAuditInTransaction(tx, ctx, {
    entityType: 'equipment_inspection_record',
    entityId: record.id,
    action: 'update',
    summary: 'Started inspection work',
    before: { status: 'draft' },
    after: { status: 'in_progress' },
  })
}

async function withLockedCriterionMutation(
  ctx: RequestContext,
  recordId: string,
  rowId: string,
  mutate: (
    tx: EquipmentInspectionTx,
    record: typeof equipmentInspectionRecords.$inferSelect,
    criterion: typeof equipmentInspectionRecordCriteria.$inferSelect,
  ) => Promise<boolean>,
): Promise<boolean> {
  if (!isUuid(recordId) || !isUuid(rowId)) {
    throw new Error('Equipment inspection item not found')
  }
  return ctx.db(async (tx) => {
    const record = await lockVisibleEquipmentInspectionForMutation(tx, ctx, recordId)
    const criterion = await criterionForMutationInTx(tx, ctx.tenantId, recordId, rowId)
    const changed = await mutate(tx, record, criterion)
    if (changed) await markEquipmentInspectionInProgressIfDraft(tx, ctx, record)
    return changed
  })
}

async function withLockedRecordMutation(
  ctx: RequestContext,
  recordId: string,
  mutate: (
    tx: EquipmentInspectionTx,
    record: typeof equipmentInspectionRecords.$inferSelect,
  ) => Promise<boolean>,
): Promise<boolean> {
  if (!isUuid(recordId)) throw new Error('Equipment inspection not found')
  return ctx.db(async (tx) => {
    const record = await lockVisibleEquipmentInspectionForMutation(tx, ctx, recordId)
    const changed = await mutate(tx, record)
    if (changed) await markEquipmentInspectionInProgressIfDraft(tx, ctx, record)
    return changed
  })
}

/** Create the record, criteria snapshot, and audit as one atomic unit. */
export async function startEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const typeId = String(formData.get('typeId') ?? '').trim()
  const equipmentItemId = String(formData.get('equipmentItemId') ?? '').trim()
  if (!isUuid(typeId)) throw new Error('Inspection type is invalid')
  if (!isUuid(equipmentItemId)) throw new Error('Equipment item is invalid')

  const occurredAt = new Date()
  const row = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(equipmentInspectionTypes)
      .where(
        and(
          eq(equipmentInspectionTypes.tenantId, ctx.tenantId),
          eq(equipmentInspectionTypes.id, typeId),
          eq(equipmentInspectionTypes.isActive, true),
        ),
      )
      .limit(1)
      .for('share')
    if (!type) throw new Error('Active inspection type not found')

    const [item] = await tx
      .select()
      .from(equipmentItems)
      .where(
        and(
          eq(equipmentItems.tenantId, ctx.tenantId),
          eq(equipmentItems.id, equipmentItemId),
          eq(equipmentItems.isDraft, false),
          notInArray(equipmentItems.status, ['retired', 'lost']),
          isNull(equipmentItems.deletedAt),
        ),
      )
      .limit(1)
      .for('share')
    if (!item) throw new Error('Equipment item not found')
    const visible = await canSeeRecord(ctx, tx, {
      prefix: 'equipment',
      siteId: item.currentSiteOrgUnitId,
      personId: item.currentHolderPersonId,
    })
    if (!visible) throw new Error('Equipment item not found')
    if (type.appliesToTypeId && item.typeId !== type.appliesToTypeId) {
      throw new Error('This inspection type does not apply to the selected equipment item')
    }

    const reference = await nextEquipmentInspectionReferenceInTx(tx, ctx.tenantId, occurredAt)
    const [created] = await tx
      .insert(equipmentInspectionRecords)
      .values({
        tenantId: ctx.tenantId,
        reference,
        inspectionTypeId: typeId,
        equipmentItemId,
        status: 'draft',
        occurredAt,
        intervalLabel: formatInterval(type.intervalValue, type.intervalUnit, {
          preUse: type.isPreUse,
        }),
        intervalValue: type.intervalValue,
        intervalUnit: type.intervalUnit,
        isPreUse: type.isPreUse,
        allowPassAll: type.allowPassAll,
        failsSpawnWorkOrders: type.failsSpawnWorkOrders,
        siteOrgUnitId: item.currentSiteOrgUnitId ?? null,
        inspectorTenantUserId: ctx.membership?.id ?? null,
        serial: item.serialNumber ?? null,
        foremanPersonIds: [],
      })
      .returning()
    if (!created) throw new Error('Failed to create equipment inspection')

    const materialised = await materialiseEquipmentCriteriaInTx(
      tx,
      ctx.tenantId,
      created.id,
      typeId,
    )
    if (materialised === 0) {
      throw new Error('This inspection type has no checklist items')
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_inspection_record',
      entityId: created.id,
      action: 'create',
      summary: `Started ${created.reference} (${type.name}) on ${item.name} — ${materialised} criteria`,
      after: {
        reference: created.reference,
        inspectionTypeId: typeId,
        equipmentItemId,
        occurredAt,
        criteriaCount: materialised,
      },
    })
    return created
  })

  revalidatePath('/equipment/inspections')
  redirect(`/equipment/inspections/${row.id}`)
}

// --- per-criterion autosave -------------------------------------------------

export async function setAnswer(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const answer = parseEqAnswer(formData.get('answer'))
  if (!answer) throw new Error('Inspection answer is invalid')

  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (criterion.kind !== 'pass_fail' && criterion.kind !== 'pass_fail_na') {
        throw new Error('This inspection item does not accept a pass/fail answer')
      }
      if (answer === 'n_a' && criterion.kind !== 'pass_fail_na') {
        throw new Error('N/A is not allowed for this inspection item')
      }
      const clearFinding = answer !== 'fail'
      const hasStaleFinding =
        clearFinding &&
        (criterion.comment != null ||
          criterion.actionTaken != null ||
          criterion.correctedOn != null)
      if (criterion.answer === answer && !hasStaleFinding) return false
      const now = new Date()
      const [updated] = await tx
        .update(equipmentInspectionRecordCriteria)
        .set({
          answer,
          answeredAt: now,
          answeredByTenantUserId: ctx.membership?.id ?? null,
          ...(clearFinding ? { comment: null, actionTaken: null, correctedOn: null } : {}),
        })
        .where(
          and(
            eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(equipmentInspectionRecordCriteria.recordId, recordId),
            eq(equipmentInspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: equipmentInspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection item changed before its answer could be saved')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_inspection_record',
        entityId: recordId,
        action: 'update',
        summary: `Answered inspection item "${answer === 'n_a' ? 'N/A' : answer}"`,
        before: { rowId, answer: criterion.answer },
        after: { rowId, answer },
      })
      return true
    },
  )
  if (changed) revalidateRecord(recordId)
}

export async function setSeverity(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const raw = String(formData.get('severity') ?? '').trim()
  const severity = raw ? parseEqSeverity(raw) : null
  if (raw && !severity) throw new Error('Inspection severity is invalid')

  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (criterion.answer !== 'fail') {
        throw new Error('Severity can only be set on a failed inspection item')
      }
      if (criterion.severity === severity) return false
      const [updated] = await tx
        .update(equipmentInspectionRecordCriteria)
        .set({ severity })
        .where(
          and(
            eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(equipmentInspectionRecordCriteria.recordId, recordId),
            eq(equipmentInspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: equipmentInspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection item changed before severity could be saved')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_inspection_record',
        entityId: recordId,
        action: 'update',
        summary: severity ? `Set finding severity to ${severity}` : 'Cleared finding severity',
        before: { rowId, severity: criterion.severity },
        after: { rowId, severity },
      })
      return true
    },
  )
  if (changed) revalidateRecord(recordId)
}

async function setFindingText(formData: FormData, field: 'comment' | 'actionTaken', label: string) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const value = normalizeInspectionTextAnswer(formData.get('value'))
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (criterion.answer !== 'fail') {
        throw new Error(`${label} can only be set on a failed inspection item`)
      }
      if (criterion[field] === value) return false
      const [updated] = await tx
        .update(equipmentInspectionRecordCriteria)
        .set({ [field]: value })
        .where(
          and(
            eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(equipmentInspectionRecordCriteria.recordId, recordId),
            eq(equipmentInspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: equipmentInspectionRecordCriteria.id })
      if (!updated) throw new Error(`Inspection item changed before ${label.toLowerCase()} saved`)
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_inspection_record',
        entityId: recordId,
        action: 'update',
        summary: value
          ? `Updated finding ${label.toLowerCase()}`
          : `Cleared finding ${label.toLowerCase()}`,
        before: { rowId, [field]: criterion[field] },
        after: { rowId, [field]: value },
      })
      return true
    },
  )
  if (changed) revalidateRecord(recordId)
}

export async function setComment(formData: FormData) {
  await setFindingText(formData, 'comment', 'Comment')
}

export async function setActionTaken(formData: FormData) {
  await setFindingText(formData, 'actionTaken', 'Action taken')
}

/** Text and numeric answers; the trusted kind comes from the snapshot row. */
export async function setValue(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (criterion.kind !== 'text' && criterion.kind !== 'numeric') {
        throw new Error('This inspection item does not accept a text or numeric value')
      }
      const value =
        criterion.kind === 'numeric'
          ? normalizeInspectionNumberAnswer(formData.get('value'))
          : normalizeInspectionTextAnswer(formData.get('value'))
      const textValue = criterion.kind === 'text' ? value : null
      const numericValue = criterion.kind === 'numeric' ? value : null
      if (criterion.textValue === textValue && criterion.numericValue === numericValue) return false
      const [updated] = await tx
        .update(equipmentInspectionRecordCriteria)
        .set({
          textValue,
          numericValue,
          answeredAt: value === null ? null : new Date(),
          answeredByTenantUserId: value === null ? null : (ctx.membership?.id ?? null),
        })
        .where(
          and(
            eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(equipmentInspectionRecordCriteria.recordId, recordId),
            eq(equipmentInspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: equipmentInspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection item changed before its value could be saved')
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_inspection_record',
        entityId: recordId,
        action: 'update',
        summary:
          value === null ? 'Cleared inspection item response' : 'Updated inspection item response',
        before: { rowId, textValue: criterion.textValue, numericValue: criterion.numericValue },
        after: { rowId, textValue, numericValue },
      })
      return true
    },
  )
  if (changed) revalidateRecord(recordId)
}

export async function addCriterionPhotos(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const rowId = String(formData.get('rowId') ?? '')
  const ids = String(formData.get('attachmentIds') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
  if (ids.length === 0) return

  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      const validIds = await validateTenantImageAttachmentIdsInTx(tx, ctx.tenantId, ids)
      const previousIds = criterion.photoAttachmentIds ?? []
      const nextIds = [...new Set([...previousIds, ...validIds])]
      if (nextIds.length === previousIds.length) return false
      const [updated] = await tx
        .update(equipmentInspectionRecordCriteria)
        .set({
          photoAttachmentIds: nextIds,
          ...(criterion.kind === 'photo'
            ? {
                answeredAt: new Date(),
                answeredByTenantUserId: ctx.membership?.id ?? null,
              }
            : {}),
        })
        .where(
          and(
            eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(equipmentInspectionRecordCriteria.recordId, recordId),
            eq(equipmentInspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: equipmentInspectionRecordCriteria.id })
      if (!updated) throw new Error('Inspection item changed before photos could be attached')
      const added = nextIds.length - previousIds.length
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_inspection_record',
        entityId: recordId,
        action: 'update',
        summary: `Attached ${added} photo${added === 1 ? '' : 's'} to an inspection item`,
        before: { rowId, photoAttachmentIds: previousIds },
        after: { rowId, photoAttachmentIds: nextIds },
      })
      return true
    },
  )
  if (changed) revalidateRecord(recordId)
}

export async function updateCriterionPhoto(
  recordId: string,
  rowId: string,
  attachmentId: string,
  input: unknown,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  if (!isUuid(attachmentId)) return { ok: false, error: 'Photo not found.' }
  const edits = parsePhotoEdits(input)
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      if (!(criterion.photoAttachmentIds ?? []).includes(attachmentId)) return false
      const [updated] = await tx
        .update(attachments)
        .set({ caption: edits.caption, annotations: edits.annotations })
        .where(
          and(
            eq(attachments.tenantId, ctx.tenantId),
            eq(attachments.id, attachmentId),
            eq(attachments.kind, 'image'),
          ),
        )
        .returning({ id: attachments.id })
      if (!updated) return false
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_inspection_record',
        entityId: recordId,
        action: 'update',
        summary: 'Updated criterion photo caption and markup',
        metadata: { rowId, attachmentId, annotationCount: edits.annotations?.length ?? 0 },
      })
      return true
    },
  )
  if (!changed) return { ok: false, error: 'Photo not found.' }
  revalidateRecord(recordId)
  return { ok: true }
}

export async function removeCriterionPhoto(
  recordId: string,
  rowId: string,
  attachmentId: string,
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  if (!isUuid(attachmentId)) return { ok: false, error: 'Photo not found.' }
  const changed = await withLockedCriterionMutation(
    ctx,
    recordId,
    rowId,
    async (tx, _record, criterion) => {
      const previousIds = criterion.photoAttachmentIds ?? []
      if (!previousIds.includes(attachmentId)) return false
      const nextIds = previousIds.filter((id) => id !== attachmentId)
      const [updated] = await tx
        .update(equipmentInspectionRecordCriteria)
        .set({ photoAttachmentIds: nextIds })
        .where(
          and(
            eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
            eq(equipmentInspectionRecordCriteria.recordId, recordId),
            eq(equipmentInspectionRecordCriteria.id, rowId),
          ),
        )
        .returning({ id: equipmentInspectionRecordCriteria.id })
      if (!updated) return false
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_inspection_record',
        entityId: recordId,
        action: 'update',
        summary: 'Removed photo from an inspection item',
        before: { rowId, photoAttachmentIds: previousIds },
        after: { rowId, photoAttachmentIds: nextIds },
      })
      return true
    },
  )
  if (!changed) return { ok: false, error: 'Photo not found.' }
  revalidateRecord(recordId)
  return { ok: true }
}

export async function passAllEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  if (!isUuid(recordId)) throw new Error('Equipment inspection not found')

  const flipped = await ctx.db(async (tx) => {
    const record = await lockVisibleEquipmentInspectionForMutation(tx, ctx, recordId)
    if (!record.allowPassAll) throw new Error('Pass all is not enabled for this inspection')

    const rows = await tx
      .select({ id: equipmentInspectionRecordCriteria.id })
      .from(equipmentInspectionRecordCriteria)
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
          isNull(equipmentInspectionRecordCriteria.answer),
          inArray(equipmentInspectionRecordCriteria.kind, ['pass_fail', 'pass_fail_na']),
        ),
      )
    if (rows.length === 0) return 0
    const updated = await tx
      .update(equipmentInspectionRecordCriteria)
      .set({
        answer: 'pass',
        answeredAt: new Date(),
        answeredByTenantUserId: ctx.membership?.id ?? null,
      })
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
          isNull(equipmentInspectionRecordCriteria.answer),
          inArray(equipmentInspectionRecordCriteria.kind, ['pass_fail', 'pass_fail_na']),
        ),
      )
      .returning({ id: equipmentInspectionRecordCriteria.id })
    if (updated.length !== rows.length) {
      throw new Error('Inspection items changed before they could all be marked pass')
    }
    await markEquipmentInspectionInProgressIfDraft(tx, ctx, record)
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_inspection_record',
      entityId: recordId,
      action: 'update',
      summary: `Marked all as pass (${updated.length} item${updated.length === 1 ? '' : 's'})`,
      metadata: { flipped: updated.length },
    })
    return updated.length
  })
  if (flipped > 0) revalidateRecord(recordId)
}

// --- record-level live fields ----------------------------------------------

export async function setRecordNotes(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const value = normalizeInspectionTextAnswer(formData.get('value'))
  const changed = await withLockedRecordMutation(ctx, recordId, async (tx, record) => {
    if (record.notes === value) return false
    const [updated] = await tx
      .update(equipmentInspectionRecords)
      .set({ notes: value })
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, recordId),
          isNull(equipmentInspectionRecords.deletedAt),
        ),
      )
      .returning({ id: equipmentInspectionRecords.id })
    if (!updated) throw new Error('Equipment inspection changed before notes could be saved')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_inspection_record',
      entityId: recordId,
      action: 'update',
      summary: value ? 'Updated inspection notes' : 'Cleared inspection notes',
      before: { notes: record.notes },
      after: { notes: value },
    })
    return true
  })
  if (changed) revalidateRecord(recordId)
}

export async function setRecordHours(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const value = normalizeInspectionNumberAnswer(formData.get('value'))
  if (value?.startsWith('-')) throw new Error('Hours reading cannot be negative')
  const changed = await withLockedRecordMutation(ctx, recordId, async (tx, record) => {
    if (record.hours === value) return false
    const [updated] = await tx
      .update(equipmentInspectionRecords)
      .set({ hours: value })
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, recordId),
          isNull(equipmentInspectionRecords.deletedAt),
        ),
      )
      .returning({ id: equipmentInspectionRecords.id })
    if (!updated) throw new Error('Equipment inspection changed before hours could be saved')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_inspection_record',
      entityId: recordId,
      action: 'update',
      summary: value == null ? 'Cleared hours reading' : 'Updated hours reading',
      before: { hours: record.hours },
      after: { hours: value },
    })
    return true
  })
  if (changed) revalidateRecord(recordId)
}

export async function setRecordOccurredAt(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const raw = String(formData.get('value') ?? '').trim()
  const occurredAt = raw ? parseDatetimeLocal(raw, ctx.timezone) : null
  if (!occurredAt) throw new Error('Inspection date and time is invalid')
  const changed = await withLockedRecordMutation(ctx, recordId, async (tx, record) => {
    if (record.occurredAt.getTime() === occurredAt.getTime()) return false
    const [updated] = await tx
      .update(equipmentInspectionRecords)
      .set({ occurredAt })
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, recordId),
          isNull(equipmentInspectionRecords.deletedAt),
        ),
      )
      .returning({ id: equipmentInspectionRecords.id })
    if (!updated) throw new Error('Equipment inspection changed before its date could be saved')
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_inspection_record',
      entityId: recordId,
      action: 'update',
      summary: 'Updated inspection date and time',
      before: { occurredAt: record.occurredAt },
      after: { occurredAt },
    })
    return true
  })
  if (changed) revalidateRecord(recordId)
}

// --- submit / reopen --------------------------------------------------------

export async function submitEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  if (!isUuid(recordId)) throw new Error('Equipment inspection not found')
  const outcome = await finaliseEquipmentInspection(ctx, recordId)
  if (!outcome.ok) {
    revalidateRecord(recordId)
    redirect(`/equipment/inspections/${recordId}?issue=${encodeURIComponent(outcome.error)}`)
  }
  revalidateRecord(recordId)
}

export async function reopenEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  if (!isUuid(recordId)) throw new Error('Equipment inspection not found')

  const reopened = await ctx.db(async (tx) => {
    const record = await lockVisibleEquipmentInspectionForMutation(tx, ctx, recordId, {
      allowFinalized: true,
    })
    if (record.status !== 'submitted' && record.status !== 'closed') return false
    const [item] = await tx
      .select({ typeId: equipmentItems.typeId })
      .from(equipmentItems)
      .where(
        and(
          eq(equipmentItems.tenantId, ctx.tenantId),
          eq(equipmentItems.id, record.equipmentItemId),
          isNull(equipmentItems.deletedAt),
        ),
      )
      .limit(1)
    if (!item) throw new Error('Equipment item not found')

    const [updated] = await tx
      .update(equipmentInspectionRecords)
      .set({
        status: 'in_progress',
        result: null,
        submittedAt: null,
        submittedByTenantUserId: null,
        closedAt: null,
        closedByTenantUserId: null,
        locked: false,
      })
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, recordId),
          inArray(equipmentInspectionRecords.status, ['submitted', 'closed']),
          isNull(equipmentInspectionRecords.deletedAt),
        ),
      )
      .returning({
        status: equipmentInspectionRecords.status,
        locked: equipmentInspectionRecords.locked,
      })
    if (!updated) throw new Error('Equipment inspection changed before it could be reopened')
    await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [item.typeId])
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_inspection_record',
      entityId: recordId,
      action: 'update',
      summary: 'Reopened for editing',
      before: {
        status: record.status,
        result: record.result,
        locked: record.locked,
        submittedAt: record.submittedAt,
        submittedByTenantUserId: record.submittedByTenantUserId,
        closedAt: record.closedAt,
        closedByTenantUserId: record.closedByTenantUserId,
      },
      after: { status: updated.status, result: null, locked: updated.locked },
    })
    return true
  })
  if (reopened) revalidateRecord(recordId)
}
