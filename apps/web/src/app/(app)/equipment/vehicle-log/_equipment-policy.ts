import { and, count, isNull, sql, type SQL } from 'drizzle-orm'
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
  // The returned predicate is also used by mutation queries that select only
  // equipment_items. Keep taxonomy checks self-contained rather than requiring
  // every consumer to join the category and type tables.
  const vehicleTaxonomy = sql`(
    exists (select 1 from ${equipmentCategories}
      where ${equipmentCategories.id} = ${equipmentItems.categoryId}
        and ${equipmentCategories.tenantId} = ${equipmentItems.tenantId}
        and ${equipmentCategories.name} ilike ${'%vehicle%'})
    or exists (select 1 from ${equipmentTypes}
      where ${equipmentTypes.id} = ${equipmentItems.typeId}
        and ${equipmentTypes.tenantId} = ${equipmentItems.tenantId}
        and ${equipmentTypes.name} ilike ${'%truck%'})
  )`
  const [classified] = await tx
    .select({ c: count() })
    .from(equipmentItems)
    .where(and(accessible, vehicleTaxonomy))
  const usesVehicleTaxonomy = Number(classified?.c ?? 0) > 0
  return {
    where: usesVehicleTaxonomy ? and(accessible, vehicleTaxonomy)! : accessible,
    usesVehicleTaxonomy,
  }
}
