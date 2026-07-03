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
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import { runModuleFlows } from '@/lib/flows/run-module-flows'
import { materialiseCriteriaForRecord, nextInspectionReference } from '../_lib'

/**
 * Create a draft inspection of the given type and jump straight to its detail
 * page. Occurred-at defaults to now and is editable inline; criteria are
 * pre-loaded from the type's grouped checklist.
 */
export async function startInspection(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'inspections.create')
  const typeId = String(formData.get('typeId') ?? '').trim()
  if (!typeId) throw new Error('Inspection type is required')

  const [type] = await ctx.db((tx) =>
    tx
      .select()
      .from(inspectionTypes)
      .where(and(eq(inspectionTypes.id, typeId), isNull(inspectionTypes.deletedAt)))
      .limit(1),
  )
  if (!type) throw new Error('Inspection type not found')

  const occurredAt = new Date()
  const reference = await nextInspectionReference(ctx, occurredAt)

  const [row] = await ctx.db((tx) =>
    tx
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
      .returning(),
  )
  if (!row) throw new Error('Failed to create inspection record')

  const materialised = await materialiseCriteriaForRecord(ctx, row.id, typeId)

  await recordAudit(ctx, {
    entityType: 'inspection_record',
    entityId: row.id,
    action: 'create',
    summary: `Started ${row.reference} (${type.name}) — materialised ${materialised} criteria`,
    after: { reference: row.reference, typeId, occurredAt },
  })

  await runModuleFlows(ctx, { moduleKey: 'inspections', event: 'on_create', subjectId: row.id })

  revalidatePath('/inspections/records')
  redirect(`/inspections/records/${row.id}`)
}
