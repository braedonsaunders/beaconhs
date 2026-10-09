import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentLocationHistory,
  equipmentStationSettings,
  orgUnits,
} from '@beaconhs/db/schema'

/** Physical custody is independent of repair/retired/missing availability. */
export const equipmentIsCheckedOutSql = sql<boolean>`(
  EXISTS (SELECT 1 FROM equipment_checkouts co WHERE co.tenant_id = ${equipmentItems.tenantId}
    AND co.equipment_item_id = ${equipmentItems.id} AND co.returned_at IS NULL)
  OR ${equipmentItems.currentHolderPersonId} IS NOT NULL
  OR (${equipmentItems.currentSiteOrgUnitId} IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM org_units location WHERE location.tenant_id = ${equipmentItems.tenantId}
      AND location.id = ${equipmentItems.currentSiteOrgUnitId} AND location.deleted_at IS NULL
      AND (location.is_equipment_base OR EXISTS (
        SELECT 1 FROM equipment_station_settings station WHERE station.tenant_id = ${equipmentItems.tenantId}
          AND station.default_check_in_org_unit_id = location.id))))
)`

type EquipmentAvailabilityState = {
  status: typeof equipmentItems.$inferSelect.status
  isMissing: boolean
  isCheckedOut: boolean
  deletedAt?: Date | null
}

type LockedEquipmentCustodyRow = {
  id: string
  assetTag: string
  typeId: string | null
  status: typeof equipmentItems.$inferSelect.status
  currentSiteOrgUnitId: string | null
  currentHolderPersonId: string | null
  isMissing: boolean
  deletedAt: Date | null
  isCheckedOut: boolean
}

export function isEquipmentAvailableForCheckout(state: EquipmentAvailabilityState): boolean {
  return (
    state.status === 'in_service' && !state.isMissing && !state.isCheckedOut && !state.deletedAt
  )
}

/**
 * Lock equipment in a stable order before changing custody or checkout state.
 * Every interactive/bulk custody writer uses this lock so overlapping requests
 * serialize on the asset rather than making decisions from the same stale row.
 */
export async function lockEquipmentCustodyRows(
  tx: Database,
  itemIds: readonly string[],
): Promise<LockedEquipmentCustodyRow[]> {
  if (itemIds.length === 0) return []
  return tx
    .select({
      id: equipmentItems.id,
      assetTag: equipmentItems.assetTag,
      typeId: equipmentItems.typeId,
      status: equipmentItems.status,
      currentSiteOrgUnitId: equipmentItems.currentSiteOrgUnitId,
      currentHolderPersonId: equipmentItems.currentHolderPersonId,
      isMissing: equipmentItems.isMissing,
      deletedAt: equipmentItems.deletedAt,
      isCheckedOut: equipmentIsCheckedOutSql,
    })
    .from(equipmentItems)
    .where(inArray(equipmentItems.id, [...itemIds]))
    .orderBy(asc(equipmentItems.id))
    .for('update')
}

export async function openEquipmentCheckoutItemIds(
  tx: Database,
  itemIds: readonly string[],
): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set()
  const rows = await tx
    .select({ itemId: equipmentCheckouts.equipmentItemId })
    .from(equipmentCheckouts)
    .where(
      and(
        inArray(equipmentCheckouts.equipmentItemId, [...itemIds]),
        isNull(equipmentCheckouts.returnedAt),
      ),
    )
  return new Set(rows.map(({ itemId }) => itemId))
}

/** Re-derive the cached availability flag from all four source-of-truth fields. */
export async function refreshEquipmentAvailability(
  tx: Database,
  itemIds: readonly string[],
): Promise<void> {
  const rows = await lockEquipmentCustodyRows(tx, itemIds)
  if (rows.length === 0) return
  const availableIds: string[] = []
  const unavailableIds: string[] = []
  for (const row of rows) {
    const bucket = isEquipmentAvailableForCheckout({
      status: row.status,
      isMissing: row.isMissing,
      isCheckedOut: row.isCheckedOut,
      deletedAt: row.deletedAt,
    })
      ? availableIds
      : unavailableIds
    bucket.push(row.id)
  }
  if (availableIds.length > 0) {
    await tx
      .update(equipmentItems)
      .set({ isAvailableForCheckout: true })
      .where(inArray(equipmentItems.id, availableIds))
  }
  if (unavailableIds.length > 0) {
    await tx
      .update(equipmentItems)
      .set({ isAvailableForCheckout: false })
      .where(inArray(equipmentItems.id, unavailableIds))
  }
}

export function openCheckoutConflictMessage(
  rows: readonly Pick<LockedEquipmentCustodyRow, 'assetTag'>[],
): string {
  const count = rows.length
  const preview = rows
    .slice(0, 3)
    .map(({ assetTag }) => assetTag)
    .join(', ')
  const remainder = count > 3 ? ` and ${count - 3} more` : ''
  return `Check in ${count === 1 ? 'this item' : 'these items'} before changing direct custody: ${preview}${remainder}.`
}

/** Refresh cached availability after changing the tenant's base configuration. */
export async function refreshAllEquipmentAvailability(tx: Database): Promise<void> {
  await tx.update(equipmentItems).set({
    isAvailableForCheckout: sql`${equipmentItems.status} = 'in_service' AND NOT ${equipmentItems.isMissing}
      AND ${equipmentItems.deletedAt} IS NULL AND NOT ${equipmentIsCheckedOutSql}`,
  })
}

export class EquipmentCustodyError extends Error {}

/** One return operation for detail, checkout list, station and kiosk. */
export async function checkInEquipmentInTx(
  tx: Database,
  args: {
    tenantId: string
    itemId: string
    expectedCheckoutId?: string
    actorTenantUserId: string | null
    actorPersonId: string | null
    canManage: boolean
    condition: 'good' | 'fair' | 'damaged' | 'unusable'
    notes: string | null
  },
) {
  const [item] = await lockEquipmentCustodyRows(tx, [args.itemId])
  if (!item || item.deletedAt) throw new EquipmentCustodyError('Equipment item not found')
  const [checkout] = await tx
    .select()
    .from(equipmentCheckouts)
    .where(
      and(eq(equipmentCheckouts.equipmentItemId, item.id), isNull(equipmentCheckouts.returnedAt)),
    )
    .limit(1)
    .for('update')
  if (args.expectedCheckoutId && checkout?.id !== args.expectedCheckoutId) return null
  if (
    !args.canManage &&
    (!args.actorPersonId ||
      (checkout?.holderPersonId ?? item.currentHolderPersonId) !== args.actorPersonId)
  )
    throw new EquipmentCustodyError('Forbidden: you can only check in equipment issued to you')
  if (!item.isCheckedOut) return null
  const [home] = await tx
    .select({ id: orgUnits.id, name: orgUnits.name })
    .from(equipmentStationSettings)
    .innerJoin(
      orgUnits,
      and(
        eq(orgUnits.id, equipmentStationSettings.defaultCheckInOrgUnitId),
        eq(orgUnits.tenantId, equipmentStationSettings.tenantId),
        isNull(orgUnits.deletedAt),
      ),
    )
    .where(eq(equipmentStationSettings.tenantId, args.tenantId))
    .limit(1)
  if (!home)
    throw new EquipmentCustodyError(
      'Set a valid default check-in location before checking equipment in',
    )
  const now = new Date()
  if (checkout)
    await tx
      .update(equipmentCheckouts)
      .set({
        returnedAt: now,
        returnedCondition: args.condition,
        returnedNotes: args.notes,
        checkedInByTenantUserId: args.actorTenantUserId,
      })
      .where(eq(equipmentCheckouts.id, checkout.id))
  await tx
    .update(equipmentItems)
    .set({
      currentHolderPersonId: null,
      currentSiteOrgUnitId: home.id,
      lastSeenSiteOrgUnitId: home.id,
      lastSeenHolderPersonId: null,
      lastSeenAt: now,
      isMissing: false,
      missingFoundAt: item.isMissing ? now : undefined,
    })
    .where(eq(equipmentItems.id, item.id))
  await refreshEquipmentAvailability(tx, [item.id])
  await tx.insert(equipmentLocationHistory).values({
    tenantId: args.tenantId,
    itemId: item.id,
    siteOrgUnitId: home.id,
    holderPersonId: null,
    recordedByTenantUserId: args.actorTenantUserId,
    recordedAt: now,
    movementKind: 'check_in',
    condition: args.condition,
    note: args.notes,
  })
  return {
    itemId: item.id,
    checkoutId: checkout?.id ?? null,
    returnSiteOrgUnitId: home.id,
    locationName: home.name,
    before: {
      siteOrgUnitId: item.currentSiteOrgUnitId,
      holderPersonId: item.currentHolderPersonId,
    },
  }
}
