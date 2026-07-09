'use server'

// Runtime server actions for performing an equipment inspection: start a record
// from (type × item), per-criterion autosave setters (matching the fill card's
// CriterionActions FormData contract), record-level live fields, and submit.
// Every setter re-checks that the parent record is still editable so a stale or
// crafted request can never mutate a submitted/closed record.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  equipmentInspectionRecordCriteria,
  equipmentInspectionRecords,
  equipmentInspectionTypes,
  equipmentItems,
} from '@beaconhs/db/schema'
import { assertCan, type RequestContext } from '@beaconhs/tenant'
import type { Database } from '@beaconhs/db'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { formatInterval } from '@/lib/equipment/intervals'
import { parseDatetimeLocal } from './_datetime'
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

/** True when the record still accepts edits (draft / in-progress). */
async function recordEditable(tx: Database, recordId: string): Promise<boolean> {
  if (!recordId) return false
  const [rec] = await tx
    .select({ status: equipmentInspectionRecords.status })
    .from(equipmentInspectionRecords)
    .where(
      and(
        eq(equipmentInspectionRecords.id, recordId),
        isNull(equipmentInspectionRecords.deletedAt),
      ),
    )
    .limit(1)
  return rec != null && rec.status !== 'submitted' && rec.status !== 'closed'
}

/** Shared preamble for the per-criterion / record-level autosave setters. */
async function editableContext(
  formData: FormData,
): Promise<{ ctx: RequestContext; rowId: string; recordId: string } | null> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const rowId = String(formData.get('rowId') ?? '')
  const recordId = String(formData.get('recordId') ?? '')
  const editable = await ctx.db((tx) => recordEditable(tx, recordId))
  if (!editable) return null
  return { ctx, rowId, recordId }
}

/**
 * Create a draft inspection of `typeId` against `equipmentItemId`, materialise
 * its criteria, and jump to the detail page.
 */
export async function startEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const typeId = String(formData.get('typeId') ?? '').trim()
  const equipmentItemId = String(formData.get('equipmentItemId') ?? '').trim()
  if (!typeId) throw new Error('Inspection type is required')
  if (!equipmentItemId) throw new Error('Equipment item is required')

  const [type] = await ctx.db((tx) =>
    tx
      .select()
      .from(equipmentInspectionTypes)
      .where(
        and(eq(equipmentInspectionTypes.id, typeId), eq(equipmentInspectionTypes.isActive, true)),
      )
      .limit(1),
  )
  if (!type) throw new Error('Inspection type not found')
  const [item] = await ctx.db((tx) =>
    tx
      .select()
      .from(equipmentItems)
      .where(and(eq(equipmentItems.id, equipmentItemId), isNull(equipmentItems.deletedAt)))
      .limit(1),
  )
  if (!item) throw new Error('Equipment item not found')
  // Type-restricted templates only apply to items of that equipment type.
  if (type.appliesToTypeId && item.typeId !== type.appliesToTypeId) {
    throw new Error('This inspection type does not apply to the selected equipment item')
  }

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
        intervalLabel: formatInterval(type.intervalValue, type.intervalUnit, {
          preUse: type.isPreUse,
        }),
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
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, rowId, recordId } = editable
  const answer = parseEqAnswer(formData.get('answer'))
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({
        answer,
        answeredAt: new Date(),
        answeredByTenantUserId: ctx.membership?.id ?? null,
      })
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.id, rowId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
        ),
      ),
  )
  revalidateRecord(recordId)
}

export async function setSeverity(formData: FormData) {
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, rowId, recordId } = editable
  const severity = parseEqSeverity(formData.get('severity'))
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({ severity })
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.id, rowId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
        ),
      ),
  )
  revalidateRecord(recordId)
}

export async function setComment(formData: FormData) {
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, rowId, recordId } = editable
  const value = String(formData.get('value') ?? '').trim() || null
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({ comment: value })
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.id, rowId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
        ),
      ),
  )
  revalidateRecord(recordId)
}

export async function setActionTaken(formData: FormData) {
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, rowId, recordId } = editable
  const value = String(formData.get('value') ?? '').trim() || null
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({ actionTaken: value })
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.id, rowId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
        ),
      ),
  )
  revalidateRecord(recordId)
}

/** Text / numeric answer kinds. */
export async function setValue(formData: FormData) {
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, rowId, recordId } = editable
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
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.id, rowId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
        ),
      ),
  )
  revalidateRecord(recordId)
}

export async function addCriterionPhotos(formData: FormData) {
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, rowId, recordId } = editable
  const ids = String(formData.get('attachmentIds') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (ids.length === 0) return
  await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ photoAttachmentIds: equipmentInspectionRecordCriteria.photoAttachmentIds })
      .from(equipmentInspectionRecordCriteria)
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.id, rowId),
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
        ),
      )
      .limit(1)
    if (!row) return
    const existing = Array.isArray(row.photoAttachmentIds) ? row.photoAttachmentIds : []
    await tx
      .update(equipmentInspectionRecordCriteria)
      .set({ photoAttachmentIds: [...existing, ...ids] })
      .where(eq(equipmentInspectionRecordCriteria.id, rowId))
  })
  revalidateRecord(recordId)
}

/**
 * "Pass all" shortcut: mark every unanswered pass/fail criterion as passed.
 * Only offered by the fill page when the type's allowPassAll flag is set.
 */
export async function passAllEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  const editable = await ctx.db((tx) => recordEditable(tx, recordId))
  if (!editable) return
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecordCriteria)
      .set({
        answer: 'pass',
        answeredAt: new Date(),
        answeredByTenantUserId: ctx.membership?.id ?? null,
      })
      .where(
        and(
          eq(equipmentInspectionRecordCriteria.recordId, recordId),
          isNull(equipmentInspectionRecordCriteria.answer),
          inArray(equipmentInspectionRecordCriteria.kind, ['pass_fail', 'pass_fail_na']),
        ),
      ),
  )
  revalidateRecord(recordId)
}

// --- record-level live fields ----------------------------------------------

export async function setRecordNotes(formData: FormData) {
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, recordId } = editable
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
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, recordId } = editable
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
  const editable = await editableContext(formData)
  if (!editable) return
  const { ctx, recordId } = editable
  const raw = String(formData.get('value') ?? '').trim()
  if (!raw) return
  // The datetime-local input posts the user's wall-clock time — parse it in
  // their timezone, never the server's.
  const occurredAt = parseDatetimeLocal(raw, ctx.timezone)
  if (!occurredAt) return
  await ctx.db((tx) =>
    tx
      .update(equipmentInspectionRecords)
      .set({ occurredAt })
      .where(eq(equipmentInspectionRecords.id, recordId)),
  )
  revalidateRecord(recordId)
}

// --- submit ----------------------------------------------------------------

export async function submitEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  if (!recordId) throw new Error('Record is required')
  const outcome = await finaliseEquipmentInspection(ctx, recordId)
  if (!outcome.ok) {
    revalidateRecord(recordId)
    redirect(`/equipment/inspections/${recordId}?issue=${encodeURIComponent(outcome.error)}`)
  }
  await recordAudit(ctx, {
    entityType: 'equipment_inspection_record',
    entityId: recordId,
    action: 'update',
    summary: `Submitted — ${outcome.result}${
      outcome.workOrdersSpawned ? `, ${outcome.workOrdersSpawned} work order(s) opened` : ''
    }`,
  })
  await runModuleFlows(ctx, {
    moduleKey: 'equipment-inspections',
    event: 'on_submit',
    subjectId: recordId,
  })
  revalidateRecord(recordId)
}

export async function reopenEquipmentInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')
  const recordId = String(formData.get('recordId') ?? '')
  if (!recordId) return
  const reopened = await ctx.db(async (tx) => {
    const [rec] = await tx
      .select({ status: equipmentInspectionRecords.status })
      .from(equipmentInspectionRecords)
      .where(eq(equipmentInspectionRecords.id, recordId))
      .limit(1)
    if (!rec || (rec.status !== 'submitted' && rec.status !== 'closed')) return false
    // The stored result is stale once the record is editable again — it gets
    // recomputed on the next submit.
    await tx
      .update(equipmentInspectionRecords)
      .set({ status: 'in_progress', submittedAt: null, result: null })
      .where(eq(equipmentInspectionRecords.id, recordId))
    return true
  })
  if (reopened) {
    await recordAudit(ctx, {
      entityType: 'equipment_inspection_record',
      entityId: recordId,
      action: 'update',
      summary: 'Reopened for editing',
    })
  }
  revalidateRecord(recordId)
}
