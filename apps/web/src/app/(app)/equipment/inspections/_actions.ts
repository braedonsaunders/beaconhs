'use server'

// Runtime server actions for performing an equipment inspection: start a record
// from (type × item), per-criterion autosave setters (matching the fill card's
// CriterionActions FormData contract), record-level live fields, and submit.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import {
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionTypes,
  equipmentItems,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  finaliseEquipmentInspection,
  materialiseEquipmentCriteria,
  nextEquipmentInspectionReference,
  parseEqAnswer,
  parseEqSeverity,
} from './_lib'

function revalidateRecord(id: string) {
  revalidatePath(`/equipment/inspections/${id}`)
  revalidatePath('/equipment/inspections')
}

/**
 * Create a draft inspection of `typeId` against `equipmentItemId`, materialise
 * its criteria, and jump to the detail page.
 */
export async function startEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  const typeId = String(formData.get('typeId') ?? '').trim()
  const equipmentItemId = String(formData.get('equipmentItemId') ?? '').trim()
  if (!typeId) throw new Error('Inspection type is required')
  if (!equipmentItemId) throw new Error('Equipment item is required')

  const [type] = await ctx.db((tx) =>
    tx
      .select()
      .from(equipmentInspectionTypes)
      .where(eq(equipmentInspectionTypes.id, typeId))
      .limit(1),
  )
  if (!type) throw new Error('Inspection type not found')
  const [item] = await ctx.db((tx) =>
    tx.select().from(equipmentItems).where(eq(equipmentItems.id, equipmentItemId)).limit(1),
  )
  if (!item) throw new Error('Equipment item not found')

  const occurredAt = new Date()
  const reference = await nextEquipmentInspectionReference(ctx, occurredAt)

  const [row] = await ctx.db((tx) =>
    tx
      .insert(equipmentInspectionRecords)
      .values({
        tenantId: ctx.tenantId,
        reference,
        inspectionTypeId: typeId,
        equipmentItemId,
        status: 'draft',
        occurredAt,
        intervalSnapshot: type.interval,
        siteOrgUnitId: item.currentSiteOrgUnitId ?? null,
        inspectorTenantUserId: ctx.membership?.id ?? null,
        serial: item.serialNumber ?? null,
        foremanPersonIds: [],
      })
      .returning(),
  )
  if (!row) throw new Error('Failed to create inspection record')

  const materialised = await materialiseEquipmentCriteria(ctx, row.id, typeId)
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_record',
    entityId: row.id,
    action: 'create',
    summary: `Started ${row.reference} (${type.name}) on ${item.name} — ${materialised} criteria`,
  })
  revalidatePath('/equipment/inspections')
  redirect(`/equipment/inspections/${row.id}`)
}

// --- per-criterion autosave (FormData contract) ----------------------------

export async function setAnswer(formData: FormData) {
  const ctx = await requireRequestContext()
  const rowId = String(formData.get('rowId') ?? '')
  const recordId = String(formData.get('recordId') ?? '')
  const answer = parseEqAnswer(formData.get('answer'))
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({
        answer,
        answeredAt: new Date(),
        answeredByTenantUserId: ctx.membership?.id ?? null,
      })
      .where(eq(equipmentInspectionRecordCriteria.id, rowId)),
  )
  revalidateRecord(recordId)
}

export async function setSeverity(formData: FormData) {
  const ctx = await requireRequestContext()
  const rowId = String(formData.get('rowId') ?? '')
  const recordId = String(formData.get('recordId') ?? '')
  const severity = parseEqSeverity(formData.get('severity'))
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({ severity })
      .where(eq(equipmentInspectionRecordCriteria.id, rowId)),
  )
  revalidateRecord(recordId)
}

export async function setComment(formData: FormData) {
  const ctx = await requireRequestContext()
  const rowId = String(formData.get('rowId') ?? '')
  const recordId = String(formData.get('recordId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({ comment: value })
      .where(eq(equipmentInspectionRecordCriteria.id, rowId)),
  )
  revalidateRecord(recordId)
}

export async function setActionTaken(formData: FormData) {
  const ctx = await requireRequestContext()
  const rowId = String(formData.get('rowId') ?? '')
  const recordId = String(formData.get('recordId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({ actionTaken: value })
      .where(eq(equipmentInspectionRecordCriteria.id, rowId)),
  )
  revalidateRecord(recordId)
}

/** Text / numeric answer kinds. */
export async function setValue(formData: FormData) {
  const ctx = await requireRequestContext()
  const rowId = String(formData.get('rowId') ?? '')
  const recordId = String(formData.get('recordId') ?? '')
  const kind = String(formData.get('kind') ?? '')
  const raw = String(formData.get('value') ?? '').trim()
  const patch =
    kind === 'numeric'
      ? { numericValue: raw === '' ? null : raw, textValue: null }
      : { textValue: raw || null, numericValue: null }
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({ ...patch, answeredAt: new Date(), answeredByTenantUserId: ctx.membership?.id ?? null })
      .where(eq(equipmentInspectionRecordCriteria.id, rowId)),
  )
  revalidateRecord(recordId)
}

export async function addCriterionPhotos(formData: FormData) {
  const ctx = await requireRequestContext()
  const rowId = String(formData.get('rowId') ?? '')
  const recordId = String(formData.get('recordId') ?? '')
  const ids = String(formData.get('attachmentIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (ids.length === 0) return
  await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ photoAttachmentIds: equipmentInspectionRecordCriteria.photoAttachmentIds })
      .from(equipmentInspectionRecordCriteria)
      .where(eq(equipmentInspectionRecordCriteria.id, rowId))
      .limit(1)
    const existing = Array.isArray(row?.photoAttachmentIds) ? row!.photoAttachmentIds : []
    await tx
      .update(equipmentInspectionRecordCriteria)
      .set({ photoAttachmentIds: [...existing, ...ids] })
      .where(eq(equipmentInspectionRecordCriteria.id, rowId))
  })
  revalidateRecord(recordId)
}

// --- record-level live fields ----------------------------------------------

export async function setRecordNotes(formData: FormData) {
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  const value = String(formData.get('value') ?? '').trim() || null
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecords)
      .set({ notes: value })
      .where(eq(equipmentInspectionRecords.id, recordId)),
  )
  revalidateRecord(recordId)
}

export async function setRecordHours(formData: FormData) {
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  const raw = String(formData.get('value') ?? '').trim()
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecords)
      .set({ hours: raw === '' ? null : raw })
      .where(eq(equipmentInspectionRecords.id, recordId)),
  )
  revalidateRecord(recordId)
}

export async function setRecordOccurredAt(formData: FormData) {
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  const raw = String(formData.get('value') ?? '').trim()
  if (!raw) return
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecords)
      .set({ occurredAt: new Date(raw) })
      .where(eq(equipmentInspectionRecords.id, recordId)),
  )
  revalidateRecord(recordId)
}

// --- submit ----------------------------------------------------------------

export async function submitEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  if (!recordId) throw new Error('Record is required')
  const outcome = await finaliseEquipmentInspection(ctx, recordId)
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_record',
    entityId: recordId,
    action: 'update',
    summary: `Submitted — ${outcome.result}${
      outcome.workOrdersSpawned ? `, ${outcome.workOrdersSpawned} work order(s) opened` : ''
    }`,
  })
  revalidateRecord(recordId)
}

export async function reopenEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  const recordId = String(formData.get('recordId') ?? '')
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecords)
      .set({ status: 'in_progress', submittedAt: null })
      .where(eq(equipmentInspectionRecords.id, recordId)),
  )
  revalidateRecord(recordId)
}
