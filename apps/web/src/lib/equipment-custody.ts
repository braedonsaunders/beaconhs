import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { equipmentCheckouts, equipmentItems } from '@beaconhs/db/schema'

type EquipmentAvailabilityState = {
  status: typeof equipmentItems.$inferSelect.status
  currentHolderPersonId: string | null
  isMissing: boolean
  hasOpenCheckout: boolean
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
}

export function isEquipmentAvailableForCheckout(state: EquipmentAvailabilityState): boolean {
  return (
    state.status === 'in_service' &&
    state.currentHolderPersonId === null &&
    !state.isMissing &&
    !state.hasOpenCheckout
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
  const openIds = await openEquipmentCheckoutItemIds(
    tx,
    rows.map(({ id }) => id),
  )
  const availableIds: string[] = []
  const unavailableIds: string[] = []
  for (const row of rows) {
    const bucket = isEquipmentAvailableForCheckout({
      status: row.status,
      currentHolderPersonId: row.currentHolderPersonId,
      isMissing: row.isMissing,
      hasOpenCheckout: openIds.has(row.id),
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

export async function lockOpenEquipmentCheckout(
  tx: Database,
  checkoutId: string,
): Promise<typeof equipmentCheckouts.$inferSelect | null> {
  const [row] = await tx
    .select()
    .from(equipmentCheckouts)
    .where(and(eq(equipmentCheckouts.id, checkoutId), isNull(equipmentCheckouts.returnedAt)))
    .limit(1)
    .for('update')
  return row ?? null
}
