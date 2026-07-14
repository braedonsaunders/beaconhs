'use server'

// Public Equipment Station kiosk actions — unauthenticated, gated by tenant slug
// (resolved to id on the page) + the tenant's equipment-station PIN. Mirrors the
// people-kiosk pattern: verify PIN, scope reads/writes via app.tenant_id, write
// an inline audit row (no RequestContext on this path). Rules come from the
// shared core so the in-app station and the kiosk behave identically.

import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { db, normalizeKioskPin, verifyKioskPin, type Database } from '@beaconhs/db'
import { auditLog, equipmentItems, equipmentStationSettings, orgUnits } from '@beaconhs/db/schema'
import {
  searchStationCore,
  stationScanCore,
  parseStationScanInput,
  type StationScanInput,
  type StationScanResult,
  type StationSearchResults,
} from '@/lib/equipment-station'
import {
  guardPublicPinRateLimit,
  recordPublicPinFailure,
  resetPublicPinRateLimit,
} from '@/lib/public-pin-rate-limit'
import { resolveActiveTenant } from '@/lib/active-tenant'
import { isUuid } from '@/lib/list-params'
import {
  equipmentStationPickerKind,
  equipmentStationPickerQuery,
  loadEquipmentStationPickerOptions,
  parseEquipmentStationPickerSearchInput,
} from '@/lib/equipment-station-picker'
import type { PickerOptionsResponse } from '@/lib/picker-options'

type Settings = {
  pin: string | null
  homeOrgUnitId: string | null
  requireHolder: boolean
} | null

export type EquipmentKioskConfig = {
  scanMode: 'toggle' | 'explicit'
  soundEnabled: boolean
  requireConditionOnCheckin: boolean
  homeLocationName: string | null
  availableCount: number
}

async function loadSettings(
  tx: Database,
  tenantId: string,
): Promise<{ tenantActive: false } | { tenantActive: true; settings: Settings }> {
  const tenant = await resolveActiveTenant(tx, { id: tenantId })
  if (!tenant) return { tenantActive: false }
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
  return { tenantActive: true, settings: row ?? null }
}

export async function searchKioskScan(input: {
  tenantId: string
  pin: string
  query: string
}): Promise<{ ok: true; results: StationSearchResults } | { ok: false; error: string }> {
  if (
    !input ||
    typeof input !== 'object' ||
    !isUuid(input.tenantId) ||
    typeof input.pin !== 'string' ||
    typeof input.query !== 'string' ||
    input.query.length > 200
  ) {
    return { ok: false, error: 'Invalid kiosk request' }
  }
  const pin = normalizeKioskPin(input.pin)
  if (!input.tenantId || !pin) return { ok: false, error: 'PIN required' }
  const pinLimit = await guardPublicPinRateLimit('equipment-kiosk', input.tenantId)
  if (!pinLimit.ok) return { ok: false, error: pinLimit.error }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database
    const loaded = await loadSettings(tx, input.tenantId)
    if (!loaded.tenantActive) return { ok: false, error: 'Workspace unavailable' }
    const settings = loaded.settings
    if (!settings?.pin) return { ok: false, error: 'Kiosk is not enabled for this tenant' }
    if (!(await verifyKioskPin(settings.pin, pin))) {
      const recorded = await recordPublicPinFailure(pinLimit.handle)
      if (!recorded.ok) return { ok: false, error: recorded.error }
      return { ok: false, error: 'Invalid PIN' }
    }
    await resetPublicPinRateLimit(pinLimit.handle)
    const results = await searchStationCore(tx, input.query)
    return { ok: true, results }
  })
}

export async function searchEquipmentKioskPicker(
  input: unknown,
): Promise<({ ok: true } & PickerOptionsResponse) | { ok: false; error: string }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Invalid kiosk request' }
  }
  const record = input as Record<string, unknown>
  const allowed = new Set(['tenantId', 'pin', 'kind', 'query', 'selected'])
  if (Object.keys(record).some((key) => !allowed.has(key))) {
    return { ok: false, error: 'Invalid kiosk request' }
  }
  const tenantId = typeof record.tenantId === 'string' ? record.tenantId : ''
  const pinValue = typeof record.pin === 'string' ? record.pin : ''
  const kind = equipmentStationPickerKind(record.kind)
  if (!isUuid(tenantId) || !kind) return { ok: false, error: 'Invalid kiosk request' }

  let pickerInput: ReturnType<typeof parseEquipmentStationPickerSearchInput>
  try {
    pickerInput = parseEquipmentStationPickerSearchInput({
      query: record.query,
      selected: record.selected,
    })
  } catch {
    return { ok: false, error: 'Invalid kiosk request' }
  }
  const pin = normalizeKioskPin(pinValue)
  if (!pin) return { ok: false, error: 'PIN required' }
  const pinLimit = await guardPublicPinRateLimit('equipment-kiosk', tenantId)
  if (!pinLimit.ok) return { ok: false, error: pinLimit.error }

  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as unknown as Database
      const loaded = await loadSettings(tx, tenantId)
      if (!loaded.tenantActive) return { ok: false as const, error: 'Workspace unavailable' }
      if (!loaded.settings?.pin) {
        return { ok: false as const, error: 'Kiosk is not enabled for this tenant' }
      }
      if (!(await verifyKioskPin(loaded.settings.pin, pin))) {
        const recorded = await recordPublicPinFailure(pinLimit.handle)
        if (!recorded.ok) return { ok: false as const, error: recorded.error }
        return { ok: false as const, error: 'Invalid PIN' }
      }
      await resetPublicPinRateLimit(pinLimit.handle)
      const response = await loadEquipmentStationPickerOptions(
        tx,
        tenantId,
        kind,
        equipmentStationPickerQuery(pickerInput),
      )
      return { ok: true as const, ...response }
    })
  } catch (error) {
    console.error('[equipment-kiosk] picker query failed', { kind, error })
    return { ok: false, error: 'Kiosk search is temporarily unavailable.' }
  }
}

export async function unlockEquipmentKiosk(input: {
  tenantId: string
  pin: string
}): Promise<{ ok: true; config: EquipmentKioskConfig } | { ok: false; error: string }> {
  if (
    !input ||
    typeof input !== 'object' ||
    !isUuid(input.tenantId) ||
    typeof input.pin !== 'string'
  ) {
    return { ok: false, error: 'Invalid kiosk request' }
  }
  const pin = normalizeKioskPin(input.pin)
  if (!input.tenantId || !pin) return { ok: false, error: 'PIN required' }
  const pinLimit = await guardPublicPinRateLimit('equipment-kiosk', input.tenantId)
  if (!pinLimit.ok) return { ok: false, error: pinLimit.error }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database
    const loaded = await loadSettings(tx, input.tenantId)
    if (!loaded.tenantActive) return { ok: false, error: 'Workspace unavailable' }
    const settings = loaded.settings
    if (!settings?.pin) return { ok: false, error: 'Kiosk is not enabled for this tenant' }
    if (!(await verifyKioskPin(settings.pin, pin))) {
      const recorded = await recordPublicPinFailure(pinLimit.handle)
      if (!recorded.ok) return { ok: false, error: recorded.error }
      return { ok: false, error: 'Invalid PIN' }
    }
    await resetPublicPinRateLimit(pinLimit.handle)

    const fullSettings = await tx
      .select({
        scanMode: equipmentStationSettings.scanMode,
        soundEnabled: equipmentStationSettings.soundEnabled,
        requireConditionOnCheckin: equipmentStationSettings.requireConditionOnCheckin,
        defaultCheckInOrgUnitId: equipmentStationSettings.defaultCheckInOrgUnitId,
      })
      .from(equipmentStationSettings)
      .where(eq(equipmentStationSettings.tenantId, input.tenantId))
      .limit(1)
      .then((rows) => rows[0] ?? null)

    const [homeRow] = fullSettings?.defaultCheckInOrgUnitId
      ? await tx
          .select({ name: orgUnits.name })
          .from(orgUnits)
          .where(
            and(
              eq(orgUnits.tenantId, input.tenantId),
              eq(orgUnits.id, fullSettings.defaultCheckInOrgUnitId),
              isNull(orgUnits.deletedAt),
            ),
          )
          .limit(1)
      : []

    const availableRows = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .where(
        and(
          eq(equipmentItems.tenantId, input.tenantId),
          eq(equipmentItems.isAvailableForCheckout, true),
          isNull(equipmentItems.deletedAt),
        ),
      )

    return {
      ok: true,
      config: {
        scanMode: fullSettings?.scanMode ?? 'toggle',
        soundEnabled: fullSettings?.soundEnabled ?? true,
        requireConditionOnCheckin: fullSettings?.requireConditionOnCheckin ?? false,
        homeLocationName: homeRow?.name ?? null,
        availableCount: Number(availableRows[0]?.c ?? 0),
      },
    }
  })
}

export async function performKioskScan(
  input: StationScanInput & { tenantId: string; pin: string; deviceLabel?: string | null },
): Promise<StationScanResult> {
  if (
    !input ||
    typeof input !== 'object' ||
    !isUuid(input.tenantId) ||
    typeof input.pin !== 'string' ||
    (input.deviceLabel !== undefined &&
      input.deviceLabel !== null &&
      (typeof input.deviceLabel !== 'string' || input.deviceLabel.length > 200))
  ) {
    return { ok: false, error: 'Invalid kiosk request' }
  }
  const parsed = parseStationScanInput(input)
  if (!parsed) return { ok: false, error: 'Invalid station scan' }
  const pin = normalizeKioskPin(input.pin)
  if (!input.tenantId || !pin) return { ok: false, error: 'PIN required' }
  const pinLimit = await guardPublicPinRateLimit('equipment-kiosk', input.tenantId)
  if (!pinLimit.ok) return { ok: false, error: pinLimit.error }
  return db.transaction(async (txRaw) => {
    const tx = txRaw as unknown as Database
    const loaded = await loadSettings(tx, input.tenantId)
    if (!loaded.tenantActive) return { ok: false, error: 'Workspace unavailable' }
    const settings = loaded.settings
    if (!settings?.pin) return { ok: false, error: 'Kiosk is not enabled for this tenant' }
    if (!(await verifyKioskPin(settings.pin, pin))) {
      const recorded = await recordPublicPinFailure(pinLimit.handle)
      if (!recorded.ok) return { ok: false, error: recorded.error }
      return { ok: false, error: 'Invalid PIN' }
    }
    await resetPublicPinRateLimit(pinLimit.handle)

    const result = await stationScanCore(tx, {
      ...parsed,
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
          deviceLabel: input.deviceLabel?.trim() || null,
        },
      })
    }
    return result
  })
}
