import { and, inArray, sql, type SQL } from 'drizzle-orm'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { equipmentItems, truckLogEntries } from '@beaconhs/db/schema'
import { can, type RequestContext } from '@beaconhs/tenant'

export function canReadVehicleLog(ctx: RequestContext): boolean {
  return canBrowseDriverLogs(ctx) || can(ctx, 'equipment.vehicle-log.update.own')
}

function canBrowseDriverLogs(ctx: RequestContext): boolean {
  return (
    can(ctx, 'equipment.manage') ||
    can(ctx, 'equipment.read.all') ||
    can(ctx, 'equipment.read.site')
  )
}

export function canEditDriverLog(ctx: RequestContext, driverPersonId: string | null): boolean {
  return (
    can(ctx, 'equipment.manage') ||
    Boolean(
      driverPersonId &&
      ctx.personId === driverPersonId &&
      can(ctx, 'equipment.vehicle-log.update.own'),
    )
  )
}

export function assertCanEditDriverLog(ctx: RequestContext, driverPersonId: string): void {
  if (!canEditDriverLog(ctx, driverPersonId))
    throw new Error('You do not have permission to edit this driver’s vehicle log.')
}

/** Own-only access cannot browse another driver through a picker or a forged URL. */
export function vehicleDriverScopeWhere(
  ctx: RequestContext,
  driverCol: PgColumn | SQL,
): SQL | undefined {
  if (canBrowseDriverLogs(ctx)) return undefined
  return can(ctx, 'equipment.vehicle-log.update.own') && ctx.personId
    ? sql`${driverCol} = ${ctx.personId}`
    : sql`false`
}

/** Both the driver and the vehicle must be visible, including for single-record actions. */
export function vehicleLogEntryScopeWhere(ctx: RequestContext, vehicleWhere: SQL): SQL {
  return and(
    inArray(
      truckLogEntries.equipmentItemId,
      sql`(select ${equipmentItems.id} from ${equipmentItems} where ${vehicleWhere})`,
    ),
    vehicleDriverScopeWhere(ctx, truckLogEntries.driverPersonId),
  )!
}
