'use server'

import { and, eq, isNull } from 'drizzle-orm'
import { equipmentItems, equipmentLogEntries } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { optionalDateInput, requireUuidInput } from '@/lib/mutation-input'
import { addIntervalToDate } from '@/lib/equipment/intervals'
import { canSeeRecord } from '@/lib/visibility'

export async function saveOilChange(form: FormData) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const id = requireUuidInput(form.get('itemId'), 'Equipment')
  const enabled = form.get('enabled') === 'on'
  const last = optionalDateInput(form.get('last'), 'Last oil change')
  const interval = form.get('interval') ? Number(form.get('interval')) : null
  const hours = form.get('hours') ? Number(form.get('hours')) : null
  if (
    (enabled && interval === null) ||
    (interval !== null && (!Number.isInteger(interval) || interval < 1 || interval > 120))
  )
    throw new Error('Enter an oil-change interval from 1 to 120 months.')
  if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 999999999))
    throw new Error('Enter valid engine hours.')
  await ctx.db(async (tx) => {
    const [item] = await tx
      .select()
      .from(equipmentItems)
      .where(and(eq(equipmentItems.id, id), isNull(equipmentItems.deletedAt)))
      .limit(1)
      .for('update')
    if (
      !item ||
      !(await canSeeRecord(ctx, tx, {
        prefix: 'equipment',
        siteId: item.currentSiteOrgUnitId,
        personId: item.currentHolderPersonId,
      }))
    )
      throw new Error('Equipment not found.')
    const next =
      enabled && last && interval
        ? addIntervalToDate(last, interval, 'month')
        : enabled
          ? last === item.lastOilChangeOn
            ? item.nextOilChangeDue
            : null
          : null
    await tx
      .update(equipmentItems)
      .set({
        requiresOilChange: enabled,
        oilChangeIntervalMonths: interval,
        lastOilChangeOn: last,
        nextOilChangeDue: next,
        metadata: { ...item.metadata, lastOilHours: hours },
      })
      .where(eq(equipmentItems.id, id))
    if (last && last !== item.lastOilChangeOn)
      await tx.insert(equipmentLogEntries).values({
        tenantId: ctx.tenantId,
        equipmentItemId: id,
        kind: 'maintenance',
        entryDate: last,
        title: 'Engine oil changed',
        details: `Engine oil changed${hours !== null ? ` at ${hours} engine hours` : ''}. Next due: ${next ?? 'not scheduled'}.`,
        createdByTenantUserId: ctx.membership?.id ?? null,
      })
    await recordAuditInTransaction(tx, ctx, {
      entityType: 'equipment',
      entityId: id,
      action: 'update',
      summary: 'Updated oil-change tracking',
      before: { lastOilChangeOn: item.lastOilChangeOn, nextOilChangeDue: item.nextOilChangeDue },
      after: {
        lastOilChangeOn: last,
        nextOilChangeDue: next,
        intervalMonths: interval,
        engineHours: hours,
      },
    })
  })
  revalidatePath(`/equipment/${id}`)
  revalidatePath('/equipment/maintenance')
}
