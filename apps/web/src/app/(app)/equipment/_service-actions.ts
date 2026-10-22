'use server'
import { parseEquipmentAutosaveInput } from '@/lib/equipment/mutation-input'
import { equipmentItems } from '@beaconhs/db/schema'
import { pgError } from '@beaconhs/db'
import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { equipmentMeters, equipmentServicePlans } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { complianceDate, resolveComplianceClock } from '@beaconhs/compliance'
import { requireRequestContext } from '@/lib/auth'
import { requireUuidInput, requiredTextInput } from '@/lib/mutation-input'
import {
  lockServiceItem,
  persistServicePlan,
  completeServicePlan,
  type ServicePlanInput,
} from '@/lib/equipment/service-plans'
import { recordAuditInTransaction } from '@/lib/audit'
function revalidate(itemId: string) {
  revalidatePath(`/equipment/${itemId}`)
  revalidatePath('/equipment/maintenance')
}
export async function saveServicePlan(itemId: string, input: ServicePlanInput) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  try {
    itemId = requireUuidInput(itemId, 'Equipment')
    await ctx.db(async (tx) => {
      const item = await lockServiceItem(tx, ctx, itemId)
      if (['retired', 'lost'].includes(item.status))
        throw new Error('Select equipment that is in use.')
      await persistServicePlan(tx, ctx, itemId, input)
    })
    revalidate(itemId)
    return { ok: true as const }
  } catch (error) {
    return {
      ok: false as const,
      error: pgError(error)
        ? 'Could not save maintenance. Check the selected values and try again.'
        : error instanceof Error
          ? error.message
          : 'Could not save maintenance.',
    }
  }
}
export async function recordServiceCompletion(input: Parameters<typeof completeServicePlan>[2]) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  try {
    await ctx.db(async (tx) => {
      const today = complianceDate(await resolveComplianceClock(tx, ctx.tenantId))
      if (input.completedOn > today)
        throw new Error('A completed maintenance date cannot be in the future.')
      await completeServicePlan(tx, ctx, input)
    })
    revalidate(input.itemId)
    return { ok: true as const }
  } catch (error) {
    return {
      ok: false as const,
      error: pgError(error)
        ? 'Could not record maintenance. Check the selected values and try again.'
        : error instanceof Error
          ? error.message
          : 'Could not record maintenance.',
    }
  }
}
export async function saveEquipmentMeter(input: {
  itemId: string
  id: string
  name: string
  unit: string
  value: number
}) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  try {
    const itemId = requireUuidInput(input.itemId, 'Equipment')
    const builtin = input.id === 'engine_hours' || input.id === 'odometer'
    const id = builtin ? input.id : requireUuidInput(input.id, 'Counter')
    const name = requiredTextInput(input.name, 'Counter name', 120)
    const unit = requiredTextInput(input.unit, 'Counter unit', 40)
    if (
      !Number.isFinite(input.value) ||
      input.value < 0 ||
      input.value > 999999999999 ||
      Math.abs(input.value * 1000 - Math.round(input.value * 1000)) > 0.0001
    )
      throw new Error('Enter a valid counter reading with at most three decimal places.')
    await ctx.db(async (tx) => {
      const item = await lockServiceItem(tx, ctx, itemId)
      if (builtin) {
        const field = id === 'engine_hours' ? 'currentHours' : 'currentOdometer'
        const parsed = parseEquipmentAutosaveInput(field, String(input.value))
        await tx
          .update(equipmentItems)
          .set({ ...{ [field]: parsed.value }, metersUpdatedAt: new Date() })
          .where(eq(equipmentItems.id, itemId))
        await recordAuditInTransaction(tx, ctx, {
          entityType: 'equipment',
          entityId: itemId,
          action: 'update',
          summary: 'Updated equipment usage reading',
          before: { [field]: item[field] },
          after: { [field]: parsed.value },
        })
        return
      }
      const [meter] = await tx
        .select()
        .from(equipmentMeters)
        .where(and(eq(equipmentMeters.id, id), eq(equipmentMeters.equipmentItemId, itemId)))
        .limit(1)
        .for('update')
      if (meter && meter.unit !== unit) {
        const [used] = await tx
          .select({ id: equipmentServicePlans.id })
          .from(equipmentServicePlans)
          .where(
            and(
              eq(equipmentServicePlans.equipmentItemId, itemId),
              sql`exists(select 1 from jsonb_array_elements(${equipmentServicePlans.rules}) r where r->>'meter'=${id})`,
            ),
          )
          .limit(1)
        if (used)
          throw new Error(
            'Counter units cannot change while maintenance uses the counter. Add a new counter instead.',
          )
      }
      const today = complianceDate(await resolveComplianceClock(tx, ctx.tenantId))
      if (meter)
        await tx
          .update(equipmentMeters)
          .set({
            name,
            unit,
            currentValue: String(input.value),
            readOn: today,
            updatedAt: new Date(),
          })
          .where(eq(equipmentMeters.id, id))
      else
        await tx.insert(equipmentMeters).values({
          id,
          tenantId: ctx.tenantId,
          equipmentItemId: itemId,
          name,
          unit,
          currentValue: String(input.value),
          readOn: today,
        })
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment',
        entityId: itemId,
        action: 'update',
        summary: `${meter ? 'Updated' : 'Added'} usage counter: ${name}`,
        before: meter
          ? { counterId: id, name: meter.name, unit: meter.unit, value: meter.currentValue }
          : undefined,
        after: { counterId: id, name, unit, value: input.value },
      })
    })
    revalidate(itemId)
    return { ok: true as const }
  } catch (error) {
    return {
      ok: false as const,
      error: pgError(error)
        ? 'Could not save counter. Check the selected values and try again.'
        : error instanceof Error
          ? error.message
          : 'Could not save counter.',
    }
  }
}
