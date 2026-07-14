'use server'

// Record-level server actions shared by the list flyout (type picker) and the
// type-detail "Start inspection" button. Creating a record needs only a type —
// the criteria materialise from it; everything else (date, site, foreman,
// notes) is captured inline on the detail page's live General-information card.

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { inspectionRecords, inspectionTypes } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { isUuid } from '@/lib/list-params'
import { materialiseCriteriaForRecordInTx, nextInspectionReferenceInTx } from '../_lib'

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
