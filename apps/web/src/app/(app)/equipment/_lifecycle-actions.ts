'use server'

import { reconcileEquipmentInspectionDatesInTx } from './inspections/_lib'

import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  equipmentCheckouts,
  equipmentInspectionRecords,
  equipmentItems,
  equipmentWorkOrders,
} from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { requireUuidInput } from '@/lib/mutation-input'
import { materializeEquipmentTypeEvidence } from '@/lib/compliance-type-evidence'

export async function setEquipmentDeleted(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const id = requireUuidInput(formData.get('id'), 'Equipment')
  const restore = formData.get('restore') === '1'
  await ctx.db(async (tx) => {
    const [item] = await tx
      .select()
      .from(equipmentItems)
      .where(and(eq(equipmentItems.tenantId, ctx.tenantId), eq(equipmentItems.id, id)))
      .limit(1)
      .for('update')
    if (!item) throw new Error('Equipment not found.')
    if (!restore) {
      const [checkout] = await tx
        .select({ id: equipmentCheckouts.id })
        .from(equipmentCheckouts)
        .where(
          and(eq(equipmentCheckouts.equipmentItemId, id), isNull(equipmentCheckouts.returnedAt)),
        )
        .limit(1)
      if (checkout) throw new Error('Check this equipment in before deleting it.')
    }
    if (Boolean(item.deletedAt) === !restore) return
    await tx
      .update(equipmentItems)
      .set({ deletedAt: restore ? null : new Date() })
      .where(and(eq(equipmentItems.tenantId, ctx.tenantId), eq(equipmentItems.id, id)))
    await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [item.typeId])
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      entityId: id,
      action: restore ? 'update' : 'delete',
      summary: restore ? 'Equipment restored' : 'Equipment deleted; history retained',
      before: { deletedAt: item.deletedAt },
      after: { deletedAt: restore ? null : new Date() },
    })
  })
  revalidatePath('/equipment')
  revalidatePath(`/equipment/${id}`)
  if (!restore) redirect('/equipment')
}

export async function setEquipmentInspectionDeleted(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const id = requireUuidInput(formData.get('recordId'), 'Inspection')
  const restore = formData.get('restore') === '1'
  const itemId = await ctx.db(async (tx) => {
    const [record] = await tx
      .select()
      .from(equipmentInspectionRecords)
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, id),
        ),
      )
      .limit(1)
      .for('update')
    if (!record) throw new Error('Inspection not found.')
    if (Boolean(record.deletedAt) === !restore) return record.equipmentItemId
    await tx
      .update(equipmentInspectionRecords)
      .set({ deletedAt: restore ? null : new Date() })
      .where(
        and(
          eq(equipmentInspectionRecords.tenantId, ctx.tenantId),
          eq(equipmentInspectionRecords.id, id),
        ),
      )
    if (record.equipmentItemId) {
      await reconcileEquipmentInspectionDatesInTx(tx, ctx.tenantId, record.equipmentItemId)
      const [item] = await tx
        .select({ typeId: equipmentItems.typeId })
        .from(equipmentItems)
        .where(eq(equipmentItems.id, record.equipmentItemId))
        .limit(1)
      if (item) await materializeEquipmentTypeEvidence(tx, ctx.tenantId, [item.typeId])
    }
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_inspection_record',
      entityId: id,
      action: restore ? 'update' : 'delete',
      summary: restore ? 'Inspection restored' : 'Inspection deleted; history retained',
    })
    return record.equipmentItemId
  })
  revalidatePath('/equipment/inspections')
  revalidatePath(`/equipment/inspections/${id}`)
  if (itemId) revalidatePath(`/equipment/${itemId}`)
  if (!restore) redirect('/equipment/inspections')
}

export async function setEquipmentWorkOrderDeleted(formData: FormData) {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')
  const id = requireUuidInput(formData.get('id'), 'Work order')
  const restore = formData.get('restore') === '1'
  const itemId = await ctx.db(async (tx) => {
    const [record] = await tx
      .select()
      .from(equipmentWorkOrders)
      .where(and(eq(equipmentWorkOrders.tenantId, ctx.tenantId), eq(equipmentWorkOrders.id, id)))
      .limit(1)
      .for('update')
    if (!record) throw new Error('Work order not found.')
    if (Boolean(record.deletedAt) === !restore) return record.itemId
    await tx
      .update(equipmentWorkOrders)
      .set({ deletedAt: restore ? null : new Date() })
      .where(and(eq(equipmentWorkOrders.tenantId, ctx.tenantId), eq(equipmentWorkOrders.id, id)))
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment_work_order',
      entityId: id,
      action: restore ? 'update' : 'delete',
      summary: restore ? 'Work order restored' : 'Work order deleted; history retained',
    })
    return record.itemId
  })
  revalidatePath('/equipment/work-orders')
  revalidatePath(`/equipment/work-orders/${id}`)
  revalidatePath(`/equipment/${itemId}`)
  if (!restore) redirect('/equipment/work-orders')
}
