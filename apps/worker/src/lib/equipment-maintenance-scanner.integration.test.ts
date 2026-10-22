import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Database } from '@beaconhs/db'
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
const state = vi.hoisted(() => ({
  pools: [] as Array<{ end: () => Promise<void> }>,
  emit: vi.fn<(tenantId: string, entries: unknown[], deliveryKey: string) => Promise<void>>(
    async () => {},
  ),
}))
vi.mock('@beaconhs/events', () => ({ emitEquipmentMaintenanceDue: state.emit }))
vi.mock('@beaconhs/db', async (load) => {
  const actual = await load<typeof import('@beaconhs/db')>()
  for (const value of [process.env.DATABASE_URL, process.env.SUPERADMIN_DATABASE_URL])
    if (!value || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname))
      throw new Error('Maintenance integration tests require an isolated localhost database')
  const app = actual.createClient({ url: process.env.DATABASE_URL!, max: 2 })
  const admin = actual.createClient({ url: process.env.SUPERADMIN_DATABASE_URL!, max: 2 })
  state.pools.push(app.sql, admin.sql)
  return {
    ...actual,
    db: app.db,
    withSuperAdmin: async <T>(_db: Database, run: (tx: Transaction) => Promise<T>) =>
      admin.db.transaction((tx) => run(tx)),
  }
})
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { equipmentItems, equipmentServicePlans, tenants } from '@beaconhs/db/schema'
import { eq } from 'drizzle-orm'
import {
  publishQueuedEquipmentMaintenance,
  scanTenantEquipmentMaintenance,
} from './equipment-maintenance-scanner'
const tenantId = randomUUID(),
  itemId = randomUUID(),
  planId = randomUUID()
beforeAll(async () => {
  await withSuperAdmin(db, async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, slug: tenantId, name: 'Maintenance dispatch proof' })
    await tx.insert(equipmentItems).values({
      id: itemId,
      tenantId,
      name: 'Dispatch proof',
      assetTag: 'QA-DISPATCH',
      qrToken: randomUUID(),
      currentHours: '100',
    })
    await tx.insert(equipmentServicePlans).values({
      id: planId,
      tenantId,
      equipmentItemId: itemId,
      name: 'Service at 100 hours',
      rules: [{ kind: 'meter', meter: 'engine_hours', every: 100, dueAt: 100 }],
    })
  })
})
afterAll(async () => {
  await withSuperAdmin(db, (tx) => tx.delete(tenants).where(eq(tenants.id, tenantId)))
  await Promise.all(state.pools.map((pool) => pool.end()))
})
describe('durable service reminder cancellation', () => {
  it('does not send stale work and still sends once if the same work becomes due later', async () => {
    expect(await scanTenantEquipmentMaintenance(tenantId)).toBe(1)
    const read = () =>
      withTenant(
        db,
        tenantId,
        async (tx) =>
          (
            await tx
              .select()
              .from(equipmentServicePlans)
              .where(eq(equipmentServicePlans.id, planId))
          )[0]!,
      )
    const original = await read()
    await withTenant(db, tenantId, (tx) =>
      tx.update(equipmentItems).set({ currentHours: '90' }).where(eq(equipmentItems.id, itemId)),
    )
    expect(await publishQueuedEquipmentMaintenance()).toMatchObject({ errors: 0 })
    // The event adapter is called with no entries; no notification is emitted.
    expect(state.emit.mock.calls.every((call) => call[1].length === 0)).toBe(true)
    const canceled = await read()
    expect(canceled.notifiedCycleId).toBeNull()
    expect(canceled.cycleId).not.toBe(original.cycleId)
    state.emit.mockClear()
    await withTenant(db, tenantId, (tx) =>
      tx.update(equipmentItems).set({ currentHours: '100' }).where(eq(equipmentItems.id, itemId)),
    )
    expect(await scanTenantEquipmentMaintenance(tenantId)).toBe(1)
    expect(await publishQueuedEquipmentMaintenance()).toMatchObject({ errors: 0 })
    expect(state.emit).toHaveBeenCalledTimes(1)
    expect(state.emit.mock.calls[0]).toEqual([
      tenantId,
      [expect.objectContaining({ servicePlanId: planId })],
      expect.any(String),
    ])
    const delivered = await read()
    expect(delivered.notifiedCycleId).toBe(delivered.cycleId)
    expect(await scanTenantEquipmentMaintenance(tenantId)).toBe(0)
  })
})
