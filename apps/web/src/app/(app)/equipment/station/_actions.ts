'use server'

// In-app Equipment Station actions. Authed + permission-gated; delegate the
// rules to the shared context-free core (lib/equipment-station). The matching
// public kiosk path lives in app/equipment-kiosk/actions.ts.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { equipmentStationSettings } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAudit } from '@/lib/audit'
import {
  resolveScanCore,
  stationScanCore,
  type ResolvedScan,
  type StationScanInput,
  type StationScanResult,
} from '@/lib/equipment-station'

export async function resolveStationScan(code: string): Promise<ResolvedScan> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  return ctx.db((tx) => resolveScanCore(tx, code))
}

export async function performStationScan(input: StationScanInput): Promise<StationScanResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')

  const result = await ctx.db(async (tx) => {
    const [settings] = await tx
      .select({
        homeOrgUnitId: equipmentStationSettings.defaultCheckInOrgUnitId,
        requireHolder: equipmentStationSettings.requireHolderOnCheckout,
      })
      .from(equipmentStationSettings)
      .where(eq(equipmentStationSettings.tenantId, ctx.tenantId))
      .limit(1)
    return stationScanCore(tx, {
      ...input,
      tenantId: ctx.tenantId,
      homeOrgUnitId: settings?.homeOrgUnitId ?? null,
      actorTenantUserId: ctx.membership?.id ?? null,
      requireHolderOnCheckout: settings?.requireHolder ?? false,
    })
  })

  if (result.ok && (result.action === 'checked_out' || result.action === 'checked_in')) {
    await recordAudit(ctx, {
      entityType: 'equipment_checkout',
      entityId: result.checkoutId ?? undefined,
      action: result.action === 'checked_out' ? 'create' : 'update',
      summary: `Station ${result.action === 'checked_out' ? 'check-out' : 'check-in'}: ${result.assetTag}`,
      after: {
        itemId: result.itemId,
        action: result.action,
        holder: result.holderName,
        location: result.locationName,
      },
    })
    revalidatePath('/equipment/station')
    revalidatePath(`/equipment/${result.itemId}`)
  }
  return result
}
