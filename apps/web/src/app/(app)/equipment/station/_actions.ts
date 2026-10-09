'use server'

// In-app Equipment Station actions. Authed + permission-gated; delegate the
// rules to the shared context-free core (lib/equipment-station). The matching
// public kiosk path lives in app/equipment-kiosk/actions.ts.

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { equipmentStationSettings } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import {
  searchStationCore,
  stationScanCore,
  parseStationScanInput,
  type StationScanInput,
  type StationScanResult,
  type StationSearchResults,
} from '@/lib/equipment-station'

export async function searchStation(query: string): Promise<StationSearchResults> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  return ctx.db((tx) => searchStationCore(tx, typeof query === 'string' ? query.slice(0, 200) : ''))
}

export async function performStationScan(input: StationScanInput): Promise<StationScanResult> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const parsed = parseStationScanInput(input)
  if (!parsed) return { ok: false, error: 'Invalid station scan' }

  const result = await ctx.db(async (tx) => {
    const [settings] = await tx
      .select({
        requireHolder: equipmentStationSettings.requireHolderOnCheckout,
      })
      .from(equipmentStationSettings)
      .where(eq(equipmentStationSettings.tenantId, ctx.tenantId))
      .limit(1)
    const scan = await stationScanCore(tx, {
      ...parsed,
      tenantId: ctx.tenantId,
      actorTenantUserId: ctx.membership?.id ?? null,
      requireHolderOnCheckout: settings?.requireHolder ?? false,
    })
    if (scan.ok && (scan.action === 'checked_out' || scan.action === 'checked_in')) {
      await recordAuditInTransaction(tx, ctx, {
        entityType: scan.checkoutId ? 'equipment_checkout' : 'equipment',
        entityId: scan.checkoutId ?? scan.itemId,
        action: scan.action === 'checked_out' ? 'create' : 'update',
        summary: `Station ${scan.action === 'checked_out' ? 'check-out' : 'check-in'}: ${scan.assetTag}`,
        after: {
          itemId: scan.itemId,
          action: scan.action,
          holder: scan.holderName,
          location: scan.locationName,
        },
      })
    }
    return scan
  })

  if (result.ok && (result.action === 'checked_out' || result.action === 'checked_in')) {
    revalidatePath('/equipment')
    revalidatePath('/dashboard')
    revalidatePath('/equipment/station')
    revalidatePath(`/equipment/${result.itemId}`)
  }
  return result
}
