import { describe, expect, it } from 'vitest'
import { PgDialect } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/node-postgres'
import { sql } from 'drizzle-orm'
import { truckLogEntries } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import {
  assertCanEditDriverLog,
  canEditDriverLog,
  canReadVehicleLog,
  vehicleDriverScopeWhere,
  vehicleLogEntryScopeWhere,
} from './_access-policy'
function context(permissions: string[], personId: string | null = 'glen'): RequestContext {
  return { permissions: new Set(permissions), personId, isSuperAdmin: false } as RequestContext
}
describe('driver vehicle-log access', () => {
  it('allows a supervisor to edit their own driver log without equipment administration', () => {
    const ctx = context(['equipment.read.site', 'equipment.vehicle-log.update.own'])
    expect(canReadVehicleLog(ctx)).toBe(true)
    expect(canEditDriverLog(ctx, 'glen')).toBe(true)
    expect(canEditDriverLog(ctx, 'someone-else')).toBe(false)
    expect(() => assertCanEditDriverLog(ctx, 'someone-else')).toThrow('permission')
  })
  it('keeps read access separate from editing and requires a linked person', () => {
    expect(canEditDriverLog(context(['equipment.read.all']), 'glen')).toBe(false)
    expect(canEditDriverLog(context(['equipment.vehicle-log.update.own'], null), 'glen')).toBe(
      false,
    )
    expect(canEditDriverLog(context(['equipment.manage']), 'someone-else')).toBe(true)
    expect(canReadVehicleLog(context([]))).toBe(false)
  })
  it('bounds own-only pickers, direct entry URLs and flow anchors by driver and vehicle', () => {
    const ctx = context(['equipment.vehicle-log.update.own'])
    const where = vehicleLogEntryScopeWhere(ctx, sql`false`)
    const query = drizzle
      .mock()
      .select({ id: truckLogEntries.id })
      .from(truckLogEntries)
      .where(where)
      .toSQL()
    expect(query.sql).toContain(
      '"truck_log_entries"."equipment_item_id" in (select "equipment_items"."id" from "equipment_items" where false)',
    )
    expect(query.sql).toContain('"truck_log_entries"."driver_person_id" =')
    expect(query.params).toEqual(['glen'])
    expect(
      new PgDialect().sqlToQuery(
        vehicleDriverScopeWhere(
          context(['equipment.vehicle-log.update.own'], null),
          truckLogEntries.driverPersonId,
        )!,
      ).sql,
    ).toBe('false')
  })
  it('keeps broader reading in its existing permission tier without granting edits to other drivers', () => {
    const ctx = context(['equipment.read.site', 'equipment.vehicle-log.update.own'])
    expect(vehicleDriverScopeWhere(ctx, truckLogEntries.driverPersonId)).toBeUndefined()
    expect(canEditDriverLog(ctx, 'someone-else')).toBe(false)
  })
})
