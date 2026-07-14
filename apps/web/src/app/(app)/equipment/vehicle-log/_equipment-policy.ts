import { and, count, eq, ilike, isNull, or, type SQL } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import { equipmentCategories, equipmentItems, equipmentTypes } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { moduleScopeWhere } from '../../../../lib/visibility'

/**
 * One vehicle-list policy for the workspace, annual summary, and CSV export.
 * Tenants that have classified at least one accessible item use their vehicle
 * category / truck type taxonomy. A tenant that has not configured that
 * taxonomy yet sees all otherwise-accessible equipment, matching the existing
 * vehicle-log onboarding behavior without a silent row cap.
 */
export async function resolveVehicleEquipmentWhere(
  ctx: RequestContext,
  tx: Database,
): Promise<{ where: SQL; usesVehicleTaxonomy: boolean }> {
  const scope = await moduleScopeWhere(ctx, tx, {
    prefix: 'equipment',
    siteCol: equipmentItems.currentSiteOrgUnitId,
    personCol: equipmentItems.currentHolderPersonId,
  })
  const accessible = and(isNull(equipmentItems.deletedAt), scope)!
  const vehicleTaxonomy = or(
    ilike(equipmentCategories.name, '%vehicle%'),
    ilike(equipmentTypes.name, '%truck%'),
  )!
  const [classified] = await tx
    .select({ c: count() })
    .from(equipmentItems)
    .leftJoin(equipmentTypes, eq(equipmentTypes.id, equipmentItems.typeId))
    .leftJoin(equipmentCategories, eq(equipmentCategories.id, equipmentItems.categoryId))
    .where(and(accessible, vehicleTaxonomy))
  const usesVehicleTaxonomy = Number(classified?.c ?? 0) > 0
  return {
    where: usesVehicleTaxonomy ? and(accessible, vehicleTaxonomy)! : accessible,
    usesVehicleTaxonomy,
  }
}
