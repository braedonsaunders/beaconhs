'use server'

import { revalidatePath } from 'next/cache'
import { eq, inArray } from 'drizzle-orm'
import { equipmentStationSettings, orgUnits } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

export type StationSettingsInput = {
  defaultCheckInOrgUnitId: string | null
  stationPin: string | null
  scanMode: 'toggle' | 'explicit'
  requireHolderOnCheckout: boolean
  requireConditionOnCheckin: boolean
  soundEnabled: boolean
  baseLocationIds: string[]
}

export async function saveStationSettings(
  input: StationSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')

  const scanMode: 'toggle' | 'explicit' = input.scanMode === 'explicit' ? 'explicit' : 'toggle'
  const pin = input.stationPin?.trim() || null
  if (pin && !/^\d{4,12}$/.test(pin)) {
    return { ok: false, error: 'Kiosk PIN must be 4–12 digits.' }
  }
  const baseIds = Array.from(new Set(input.baseLocationIds.filter(Boolean)))
  const home = input.defaultCheckInOrgUnitId || null

  await ctx.db(async (tx) => {
    const values = {
      defaultCheckInOrgUnitId: home,
      stationPin: pin,
      scanMode,
      requireHolderOnCheckout: input.requireHolderOnCheckout,
      requireConditionOnCheckin: input.requireConditionOnCheckin,
      soundEnabled: input.soundEnabled,
    }
    await tx
      .insert(equipmentStationSettings)
      .values({ tenantId: ctx.tenantId, ...values })
      .onConflictDoUpdate({
        target: equipmentStationSettings.tenantId,
        set: { ...values, updatedAt: new Date() },
      })

    // Re-sync which org-units count as "at base / checked in".
    await tx
      .update(orgUnits)
      .set({ isEquipmentBase: false })
      .where(eq(orgUnits.isEquipmentBase, true))
    if (baseIds.length > 0) {
      await tx.update(orgUnits).set({ isEquipmentBase: true }).where(inArray(orgUnits.id, baseIds))
    }
  })

  await recordAudit(ctx, {
    entityType: 'equipment_station_settings',
    action: 'update',
    summary: 'Updated check-in/out station settings',
    after: { home, scanMode, baseCount: baseIds.length, kioskEnabled: Boolean(pin) },
  })
  revalidatePath('/equipment/station')
  revalidatePath('/equipment/station/settings')
  return { ok: true }
}
