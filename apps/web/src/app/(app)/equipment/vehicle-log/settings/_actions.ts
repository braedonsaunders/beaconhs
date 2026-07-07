'use server'

// Vehicle log settings mutations — tenant-level enabled modes / default mode
// (vehicle_log_settings, one row per tenant) and per-driver default-mode
// overrides (people.metadata.vehicleLogMode). Gated by equipment.manage via
// the module-admin guard; every change is audited.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { people, vehicleLogSettings, type VehicleLogEnabledModes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAudit } from '@/lib/audit'

export type VehicleLogSettingsInput = {
  enabledModes: VehicleLogEnabledModes
  defaultMode: 'destination' | 'odometer'
}

function revalidateVehicleLogSettings() {
  revalidatePath('/equipment/vehicle-log')
  revalidatePath('/equipment/vehicle-log/settings')
}

export async function saveVehicleLogSettings(
  input: VehicleLogSettingsInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'vehicle-log')

  const enabledModes: VehicleLogEnabledModes =
    input.enabledModes === 'destination' || input.enabledModes === 'odometer'
      ? input.enabledModes
      : 'both'
  const requestedDefault = input.defaultMode === 'odometer' ? 'odometer' : 'destination'
  // A single-mode tenant's default is that mode — never a disabled one.
  const defaultMode = enabledModes === 'both' ? requestedDefault : enabledModes

  try {
    await ctx.db((tx) =>
      tx
        .insert(vehicleLogSettings)
        .values({ tenantId: ctx.tenantId, enabledModes, defaultMode })
        .onConflictDoUpdate({
          target: vehicleLogSettings.tenantId,
          set: { enabledModes, defaultMode, updatedAt: new Date() },
        }),
    )
    await recordAudit(ctx, {
      entityType: 'vehicle_log_settings',
      entityId: ctx.tenantId,
      action: 'update',
      summary: 'Updated vehicle log mode settings',
      after: { enabledModes, defaultMode },
    })
    revalidateVehicleLogSettings()
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to save vehicle log settings.',
    }
  }
}

export async function setDriverDefaultMode(input: {
  personId: string
  mode: 'destination' | 'odometer' | null
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCanManageModule(ctx, 'vehicle-log')
  if (!input.personId) return { ok: false, error: 'Choose a person.' }
  const mode = input.mode === 'destination' || input.mode === 'odometer' ? input.mode : null

  try {
    const updated = await ctx.db(async (tx) => {
      const [person] = await tx
        .select({ id: people.id, metadata: people.metadata })
        .from(people)
        .where(eq(people.id, input.personId))
        .limit(1)
      if (!person) return null
      const metadata = { ...(person.metadata ?? {}) } as Record<string, unknown>
      if (mode) metadata.vehicleLogMode = mode
      else delete metadata.vehicleLogMode
      await tx.update(people).set({ metadata }).where(eq(people.id, person.id))
      return person.id
    })
    if (!updated) return { ok: false, error: 'Person not found.' }

    await recordAudit(ctx, {
      entityType: 'person',
      entityId: input.personId,
      action: 'update',
      summary: mode
        ? `Set vehicle log default mode to ${mode}`
        : 'Cleared vehicle log default mode',
      after: { vehicleLogMode: mode },
    })
    revalidateVehicleLogSettings()
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update the driver default.',
    }
  }
}
