'use server'

// Vehicle log settings mutations — tenant-level enabled modes / default mode
// (vehicle_log_settings, one row per tenant) and per-driver default-mode
// overrides (people.metadata.vehicleLogMode). Gated by equipment.manage via
// the module-admin guard; every change is audited.

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { people, vehicleLogSettings, type VehicleLogEnabledModes } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { assertCanManageModule } from '@/lib/module-admin/guard'
import { recordAuditInTransaction } from '@/lib/audit'
import { requireUuidInput } from '@/lib/mutation-input'

type VehicleLogSettingsInput = {
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
    const changed = await ctx.db(async (tx) => {
      const [prior] = await tx
        .select({
          enabledModes: vehicleLogSettings.enabledModes,
          defaultMode: vehicleLogSettings.defaultMode,
        })
        .from(vehicleLogSettings)
        .where(eq(vehicleLogSettings.tenantId, ctx.tenantId))
        .limit(1)
        .for('update')
      if (prior?.enabledModes === enabledModes && prior.defaultMode === defaultMode) return false

      await tx
        .insert(vehicleLogSettings)
        .values({ tenantId: ctx.tenantId, enabledModes, defaultMode })
        .onConflictDoUpdate({
          target: vehicleLogSettings.tenantId,
          set: { enabledModes, defaultMode, updatedAt: new Date() },
        })
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'vehicle_log_settings',
        entityId: ctx.tenantId,
        action: 'update',
        summary: 'Updated vehicle log mode settings',
        before: prior ?? null,
        after: { enabledModes, defaultMode },
      })
      return true
    })
    if (changed) revalidateVehicleLogSettings()
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

  try {
    const personId = requireUuidInput(input.personId, 'Person')
    if (input.mode !== null && input.mode !== 'destination' && input.mode !== 'odometer') {
      return { ok: false, error: 'Choose destination or odometer.' }
    }
    const mode = input.mode
    const result = await ctx.db(async (tx) => {
      const [person] = await tx
        .select({ id: people.id, metadata: people.metadata })
        .from(people)
        .where(and(eq(people.id, personId), eq(people.status, 'active'), isNull(people.deletedAt)))
        .limit(1)
        .for('update')
      if (!person) return 'missing' as const
      const metadata = { ...(person.metadata ?? {}) } as Record<string, unknown>
      const priorMode =
        metadata.vehicleLogMode === 'destination' || metadata.vehicleLogMode === 'odometer'
          ? metadata.vehicleLogMode
          : null
      if (priorMode === mode) return 'unchanged' as const
      if (mode) metadata.vehicleLogMode = mode
      else delete metadata.vehicleLogMode
      const [updated] = await tx
        .update(people)
        .set({ metadata })
        .where(and(eq(people.id, person.id), eq(people.status, 'active'), isNull(people.deletedAt)))
        .returning({ id: people.id })
      if (!updated) return 'missing' as const
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'person',
        entityId: personId,
        action: 'update',
        summary: mode
          ? `Set vehicle log default mode to ${mode}`
          : 'Cleared vehicle log default mode',
        before: { vehicleLogMode: priorMode },
        after: { vehicleLogMode: mode },
      })
      return 'updated' as const
    })
    if (result === 'missing') return { ok: false, error: 'Active person not found.' }
    if (result === 'updated') revalidateVehicleLogSettings()
    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to update the driver default.',
    }
  }
}
