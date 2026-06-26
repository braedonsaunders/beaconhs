'use server'

// Public Equipment Station kiosk actions — unauthenticated, gated by tenant slug
// (resolved to id on the page) + the tenant's equipment-station PIN. Mirrors the
// people-kiosk pattern: verify PIN, scope reads/writes via app.tenant_id, write
// an inline audit row (no RequestContext on this path). Rules come from the
// shared core so the in-app station and the kiosk behave identically.

import { sql, eq } from 'drizzle-orm'
import { db, type Database } from '@beaconhs/db'
import { auditLog, equipmentStationSettings } from '@beaconhs/db/schema'
import {
  resolveScanCore,
  stationScanCore,
  type ResolvedScan,
  type StationScanInput,
  type StationScanResult,
} from '@/lib/equipment-station'

type Settings = {
  pin: string | null
  homeOrgUnitId: string | null
  requireHolder: boolean
} | null

async function loadSettings(tx: Database, tenantId: string): Promise<Settings> {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`)
  const [row] = await tx
    .select({
      pin: equipmentStationSettings.stationPin,
      homeOrgUnitId: equipmentStationSettings.defaultCheckInOrgUnitId,
      requireHolder: equipmentStationSettings.requireHolderOnCheckout,
    })
    .from(equipmentStationSettings)
    .where(eq(equipmentStationSettings.tenantId, tenantId))
    .limit(1)
  return row ?? null
}

export async function resolveKioskScan(input: {
  tenantId: string
  pin: string
  code: string
}): Promise<{ ok: true; result: ResolvedScan } | { ok: false; error: string }> {
  if (!input.tenantId || !input.pin) return { ok: false, error: 'PIN required' }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database
    const settings = await loadSettings(tx, input.tenantId)
    if (!settings?.pin) return { ok: false, error: 'Kiosk is not enabled for this tenant' }
    if (settings.pin !== input.pin) return { ok: false, error: 'Invalid PIN' }
    const result = await resolveScanCore(tx, input.code)
    return { ok: true, result }
  })
}

export async function performKioskScan(
  input: StationScanInput & { tenantId: string; pin: string; deviceLabel?: string | null },
): Promise<StationScanResult> {
  if (!input.tenantId || !input.pin) return { ok: false, error: 'PIN required' }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database
    const settings = await loadSettings(tx, input.tenantId)
    if (!settings?.pin) return { ok: false, error: 'Kiosk is not enabled for this tenant' }
    if (settings.pin !== input.pin) return { ok: false, error: 'Invalid PIN' }

    const result = await stationScanCore(tx, {
      ...input,
      tenantId: input.tenantId,
      homeOrgUnitId: settings.homeOrgUnitId,
      actorTenantUserId: null,
      requireHolderOnCheckout: settings.requireHolder,
    })

    if (result.ok && (result.action === 'checked_out' || result.action === 'checked_in')) {
      await tx.insert(auditLog).values({
        tenantId: input.tenantId,
        actorUserId: null,
        entityType: 'equipment_checkout',
        entityId: result.checkoutId,
        action: result.action === 'checked_out' ? 'create' : 'update',
        summary: `Kiosk ${result.action === 'checked_out' ? 'check-out' : 'check-in'}: ${result.assetTag}`,
        after: {
          itemId: result.itemId,
          action: result.action,
          holder: result.holderName,
          location: result.locationName,
          deviceLabel: input.deviceLabel ?? null,
        },
      })
    }
    return result
  })
}
