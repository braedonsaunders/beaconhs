'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { equipmentStationSettings, orgUnits } from '@beaconhs/db/schema'
import { hashKioskPin } from '@beaconhs/db'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  parseStationBaseLocationInput,
  parseStationSettingsInput,
  type StationSettingsInput,
} from './_policy'

type Result = { ok: true } | { ok: false; error: string }

class StationSettingsMutationError extends Error {}

function inputError(error: unknown, fallback: string): Result {
  return { ok: false, error: error instanceof Error ? error.message : fallback }
}

function persistenceError(operation: string, error: unknown): Result {
  if (error instanceof StationSettingsMutationError) return { ok: false, error: error.message }
  console.error(`[equipment-station-settings] ${operation} failed`, error)
  return { ok: false, error: `Could not ${operation}. Please try again.` }
}

export async function saveStationSettings(input: unknown): Promise<Result> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')

  let parsed: StationSettingsInput
  try {
    parsed = parseStationSettingsInput(input)
  } catch (error) {
    return inputError(error, 'Station settings are invalid.')
  }

  let nextPinHash: string | null | undefined
  try {
    nextPinHash = parsed.clearStationPin
      ? null
      : parsed.stationPin
        ? await hashKioskPin(parsed.stationPin)
        : undefined
  } catch (error) {
    return persistenceError('secure the kiosk PIN', error)
  }

  try {
    await ctx.db(async (tx) => {
      if (parsed.defaultCheckInOrgUnitId) {
        const [home] = await tx
          .select({ id: orgUnits.id })
          .from(orgUnits)
          .where(
            and(
              eq(orgUnits.tenantId, ctx.tenantId),
              eq(orgUnits.id, parsed.defaultCheckInOrgUnitId),
              isNull(orgUnits.deletedAt),
            ),
          )
          .limit(1)
          .for('share')
        if (!home) {
          throw new StationSettingsMutationError(
            'The selected default check-in location is no longer available.',
          )
        }
      }

      const [current] = await tx
        .select({
          defaultCheckInOrgUnitId: equipmentStationSettings.defaultCheckInOrgUnitId,
          stationPin: equipmentStationSettings.stationPin,
          scanMode: equipmentStationSettings.scanMode,
          requireHolderOnCheckout: equipmentStationSettings.requireHolderOnCheckout,
          requireConditionOnCheckin: equipmentStationSettings.requireConditionOnCheckin,
          soundEnabled: equipmentStationSettings.soundEnabled,
        })
        .from(equipmentStationSettings)
        .where(eq(equipmentStationSettings.tenantId, ctx.tenantId))
        .limit(1)
        .for('update')
      const stationPin = nextPinHash === undefined ? (current?.stationPin ?? null) : nextPinHash
      const values = {
        defaultCheckInOrgUnitId: parsed.defaultCheckInOrgUnitId,
        stationPin,
        scanMode: parsed.scanMode,
        requireHolderOnCheckout: parsed.requireHolderOnCheckout,
        requireConditionOnCheckin: parsed.requireConditionOnCheckin,
        soundEnabled: parsed.soundEnabled,
      }
      await tx
        .insert(equipmentStationSettings)
        .values({ tenantId: ctx.tenantId, ...values })
        .onConflictDoUpdate({
          target: equipmentStationSettings.tenantId,
          set: { ...values, updatedAt: new Date() },
        })
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment_station_settings',
        action: 'update',
        summary: 'Updated check-in/out station settings',
        before: current
          ? {
              defaultCheckInOrgUnitId: current.defaultCheckInOrgUnitId,
              scanMode: current.scanMode,
              requireHolderOnCheckout: current.requireHolderOnCheckout,
              requireConditionOnCheckin: current.requireConditionOnCheckin,
              soundEnabled: current.soundEnabled,
              kioskEnabled: Boolean(current.stationPin),
            }
          : null,
        after: {
          defaultCheckInOrgUnitId: parsed.defaultCheckInOrgUnitId,
          scanMode: parsed.scanMode,
          requireHolderOnCheckout: parsed.requireHolderOnCheckout,
          requireConditionOnCheckin: parsed.requireConditionOnCheckin,
          soundEnabled: parsed.soundEnabled,
          kioskEnabled: Boolean(stationPin),
        },
      })
    })
  } catch (error) {
    return persistenceError('save station settings', error)
  }

  revalidatePath('/equipment/station')
  revalidatePath('/equipment/station/settings')
  return { ok: true }
}

export async function setStationBaseLocation(input: unknown): Promise<Result> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'equipment')

  let parsed: ReturnType<typeof parseStationBaseLocationInput>
  try {
    parsed = parseStationBaseLocationInput(input)
  } catch (error) {
    return inputError(error, 'Base location update is invalid.')
  }

  try {
    const found = await ctx.db(async (tx) => {
      const [location] = await tx
        .select({ id: orgUnits.id, name: orgUnits.name, isBase: orgUnits.isEquipmentBase })
        .from(orgUnits)
        .where(
          and(
            eq(orgUnits.tenantId, ctx.tenantId),
            eq(orgUnits.id, parsed.id),
            isNull(orgUnits.deletedAt),
          ),
        )
        .limit(1)
        .for('update')
      if (!location) return false
      if (location.isBase === parsed.isBase) return true

      await tx
        .update(orgUnits)
        .set({ isEquipmentBase: parsed.isBase })
        .where(and(eq(orgUnits.tenantId, ctx.tenantId), eq(orgUnits.id, parsed.id)))
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'org_unit',
        entityId: parsed.id,
        action: 'update',
        summary: `${parsed.isBase ? 'Marked' : 'Unmarked'} "${location.name}" as an equipment base`,
        before: { isEquipmentBase: location.isBase },
        after: { isEquipmentBase: parsed.isBase },
      })
      return true
    })
    if (!found) return { ok: false, error: 'Location not found.' }
  } catch (error) {
    return persistenceError('update the base location', error)
  }

  revalidatePath('/equipment/station')
  revalidatePath('/equipment/station/settings')
  return { ok: true }
}
