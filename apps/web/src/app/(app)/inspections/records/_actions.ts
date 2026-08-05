'use server'

// Record-level server actions shared by the list flyout (type picker) and the
// type-detail "Start inspection" button. Creating a record needs only a type —
// the criteria materialise from it; everything else (date, site, foreman,
// notes) is captured inline on the detail page's live General-information card.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { inspectionRecordCriteria, inspectionRecords, inspectionTypes } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { materializeEvidenceTargetObligations } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import {
  lockVisibleInspectionRecordForMutation,
  materialiseCriteriaForRecordInTx,
  nextInspectionReferenceInTx,
} from '../_lib'

/**
 * Create a draft inspection of the given type and jump straight to its detail
 * page. Occurred-at defaults to now and is editable inline; criteria are
 * pre-loaded from the type's grouped checklist.
 */
export async function startInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.create')
  const typeId = String(formData.get('typeId') ?? '').trim()
  if (!isUuid(typeId)) throw new Error('Inspection type is invalid')

  const occurredAt = new Date()
  const result = await ctx.db(async (tx) => {
    const [type] = await tx
      .select()
      .from(inspectionTypes)
      .where(
        and(
          eq(inspectionTypes.tenantId, ctx.tenantId),
          eq(inspectionTypes.id, typeId),
          eq(inspectionTypes.isPublished, true),
          isNull(inspectionTypes.deletedAt),
        ),
      )
      .limit(1)
    if (!type) throw new Error('Published inspection type not found')

    const reference = await nextInspectionReferenceInTx(tx, ctx.tenantId, occurredAt)
    const [row] = await tx
      .insert(inspectionRecords)
      .values({
        tenantId: ctx.tenantId,
        reference,
        typeId,
        status: 'draft',
        occurredAt,
        foremanPersonIds: [],
        inspectorTenantUserId: ctx.membership?.id ?? null,
      })
      .returning()
    if (!row) throw new Error('Failed to create inspection record')
    const materialised = await materialiseCriteriaForRecordInTx(tx, ctx.tenantId, row.id, typeId)
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: row.id,
      moduleKey: 'inspections',
      event: 'on_create',
      occurrenceKey: row.id,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: row.id,
      action: 'create',
      summary: `Started ${row.reference} (${type.name}) — materialised ${materialised} criteria`,
      after: { reference: row.reference, typeId, occurredAt },
    })
    return { row, materialised }
  })

  revalidatePath('/inspections/records')
  redirect(`/inspections/records/${result.row.id}`)
}

/** Copy an inspection's setup and immutable checklist snapshots into a fresh draft. */
export async function copyInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.create')
  const sourceId = String(formData.get('id') ?? '')
  if (!isUuid(sourceId)) throw new Error('Inspection record was not found')
  const occurredAt = new Date()
  const newId = await ctx.db(async (tx) => {
    const source = await lockVisibleInspectionRecordForMutation(tx, ctx, sourceId, {
      allowLocked: true,
    })
    const reference = await nextInspectionReferenceInTx(tx, ctx.tenantId, occurredAt)
    const [created] = await tx
      .insert(inspectionRecords)
      .values({
        tenantId: ctx.tenantId,
        reference,
        typeId: source.typeId,
        status: 'draft',
        locked: false,
        occurredAt,
        siteOrgUnitId: source.siteOrgUnitId,
        locationOnSite: source.locationOnSite,
        inspectorTenantUserId: ctx.membership?.id ?? null,
        supervisorTenantUserId: source.supervisorTenantUserId,
        foremanPersonIds: source.foremanPersonIds,
        foremanText: source.foremanText,
        customerOrgUnitId: source.customerOrgUnitId,
        customerContactPersonId: source.customerContactPersonId,
        customerContactName: source.customerContactName,
        notes: source.notes,
        metadata: source.metadata,
      })
      .returning({ id: inspectionRecords.id })
    if (!created) throw new Error('Copied inspection could not be created')

    const criteria = await tx
      .select()
      .from(inspectionRecordCriteria)
      .where(eq(inspectionRecordCriteria.recordId, sourceId))
      .orderBy(asc(inspectionRecordCriteria.sequence))
    if (criteria.length > 0) {
      await tx.insert(inspectionRecordCriteria).values(
        criteria.map((criterion) => ({
          tenantId: ctx.tenantId,
          recordId: created.id,
          criterionId: criterion.criterionId,
          questionTextSnapshot: criterion.questionTextSnapshot,
          groupLabelSnapshot: criterion.groupLabelSnapshot,
          responseType: criterion.responseType,
          choiceOptionsSnapshot: criterion.choiceOptionsSnapshot,
          requiresPhoto: criterion.requiresPhoto,
          requiresComment: criterion.requiresComment,
          sequence: criterion.sequence,
          photoAttachmentIds: [],
        })),
      )
    }
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: created.id,
      moduleKey: 'inspections',
      event: 'on_create',
      occurrenceKey: created.id,
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: created.id,
      action: 'create',
      summary: `Copied inspection from ${source.reference}`,
      after: { sourceId, reference, criteriaCount: criteria.length },
    })
    return created.id
  })
  revalidatePath('/inspections/records')
  redirect(`/inspections/records/${newId}`)
}

/** Manager-only soft deletion preserving evidence, audit, and lifecycle history. */
export async function deleteInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'inspections')
  const id = String(formData.get('id') ?? '')
  if (!isUuid(id)) throw new Error('Inspection record was not found')
  await ctx.db(async (tx) => {
    const record = await lockVisibleInspectionRecordForMutation(tx, ctx, id, {
      allowLocked: true,
    })
    const [deleted] = await tx
      .update(inspectionRecords)
      .set({ deletedAt: new Date() })
      .where(and(eq(inspectionRecords.id, id), isNull(inspectionRecords.deletedAt)))
      .returning({ id: inspectionRecords.id })
    if (!deleted) throw new Error('Inspection record was already deleted')
    await recordModuleFlowEvent(tx, ctx, {
      subjectId: id,
      moduleKey: 'inspections',
      event: 'on_delete',
      occurrenceKey: randomUUID(),
    })
    await materializeEvidenceTargetObligations(tx, ctx.tenantId, {
      sourceModule: 'inspection',
      targetRef: { inspectionTypeId: record.typeId },
    })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'inspection_record',
      entityId: id,
      action: 'delete',
      summary: `Soft-deleted ${record.reference}`,
    })
  })
  revalidatePath('/inspections/records')
  redirect('/inspections/records')
}
