import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { and, eq } from 'drizzle-orm'
import { createClient, createSuperClient, withTenant } from '@beaconhs/db'
import {
  equipmentItems,
  equipmentTelemetryAssets as inventory,
  equipmentTelemetryObservations as history,
  syncConnections,
  syncCrosswalk,
  syncRuns,
  tenants,
} from '@beaconhs/db/schema'
import { applyEquipmentTelemetry } from './equipment-telemetry'
import { runSync } from './orchestrator'
import type { EquipmentTelemetryAsset } from './types'

// CI explicitly enables this against disposable PostgreSQL; never borrow
// a developer's production connection for persistence tests.
test(
  'telemetry preserves custody, assignments, RLS and overlapping history',
  { skip: process.env.BEACON_TELEMETRY_DB_TEST !== '1' },
  async () => {
    assert.ok(
      ['localhost', '127.0.0.1', '::1'].includes(new URL(process.env.DATABASE_URL!).hostname),
      'Telemetry DB tests require an isolated local database',
    )
    const app = createClient({ max: 2 }),
      admin = createSuperClient({ max: 1 })
    const a = randomUUID(),
      b = randomUUID(),
      connectionId = randomUUID(),
      otherConnection = randomUUID(),
      itemId = randomUUID(),
      otherItem = randomUUID()
    const at = new Date('2026-01-03T10:00:00Z')
    const point = {
      observedAt: at.toISOString(),
      latitude: 43,
      longitude: -80,
      speedKph: 0,
      engineOn: false,
    }
    const asset: EquipmentTelemetryAsset = {
      externalId: 'source-a',
      name: 'Source name',
      vin: null,
      deviceSerials: ['device-a'],
      deviceModels: ['tracker'],
      deactivated: false,
      lastReportedAt: at.toISOString(),
      gpsValid: true,
      address: 'Old address',
      observations: [point],
    }
    const read = () =>
      withTenant(app.db, a, (tx) =>
        tx.select().from(inventory).where(eq(inventory.externalId, asset.externalId)),
      )
    const apply = (assets: EquipmentTelemetryAsset[], dryRun = false) =>
      withTenant(app.db, a, (tx) =>
        applyEquipmentTelemetry(tx, { tenantId: a, connectionId, assets, dryRun }),
      )
    try {
      await admin.db.insert(tenants).values([
        { id: a, slug: 'telemetry-test-' + a, name: 'Telemetry A' },
        { id: b, slug: 'telemetry-test-' + b, name: 'Telemetry B' },
      ])
      await withTenant(app.db, a, async (tx) => {
        await tx.insert(syncConnections).values({
          id: connectionId,
          tenantId: a,
          name: 'Provider-neutral test',
          connectorKey: 'unity',
        })
        await tx.insert(equipmentItems).values({
          id: itemId,
          tenantId: a,
          assetTag: 'equipment-a',
          name: 'Manual name',
          qrToken: randomUUID(),
          notes: 'Manual custody survives',
          currentOdometer: 200,
        })
      })
      await withTenant(app.db, b, async (tx) => {
        await tx
          .insert(syncConnections)
          .values({ id: otherConnection, tenantId: b, name: 'Other tenant', connectorKey: 'unity' })
        await tx.insert(equipmentItems).values({
          id: otherItem,
          tenantId: b,
          assetTag: 'equipment-b',
          name: 'Other equipment',
          qrToken: randomUUID(),
        })
      })
      await apply([asset])
      const [first] = await read()
      assert.ok(first)
      await withTenant(app.db, a, (tx) =>
        tx
          .update(inventory)
          .set({ itemId, boundAt: new Date(at.getTime() + 1000) })
          .where(eq(inventory.id, first.id)),
      )
      const newer = {
        ...point,
        observedAt: new Date(at.getTime() + 2000).toISOString(),
        latitude: 44,
      }
      await apply([
        {
          ...asset,
          address: 'New address',
          lastReportedAt: newer.observedAt,
          observations: [newer, point, newer],
        },
      ])
      await apply([asset])
      const [saved] = await read()
      assert.equal(saved?.latitude, 44)
      assert.equal(saved?.itemId, itemId)
      assert.equal(saved?.address, 'New address')
      const readings = await withTenant(app.db, a, (tx) =>
        tx.select().from(history).where(eq(history.telemetryAssetId, first.id)),
      )
      assert.equal(readings.length, 2)
      assert.equal(readings.find((row) => row.observedAt.getTime() === at.getTime())?.itemId, null)
      assert.equal(
        readings.find((row) => row.observedAt.getTime() === at.getTime() + 2000)?.itemId,
        itemId,
      )
      const [equipment] = await withTenant(app.db, a, (tx) =>
        tx.select().from(equipmentItems).where(eq(equipmentItems.id, itemId)),
      )
      assert.equal(equipment?.name, 'Manual name')
      assert.equal(equipment?.notes, 'Manual custody survives')
      assert.equal(equipment?.currentOdometer, 200)
      assert.deepEqual(
        await withTenant(app.db, a, (tx) =>
          tx.select().from(syncCrosswalk).where(eq(syncCrosswalk.connectionId, connectionId)),
        ),
        [],
      )
      await apply([
        {
          ...asset,
          lastReportedAt: new Date(at.getTime() + 3000).toISOString(),
          gpsValid: false,
          address: 'Invalid fix address',
          observations: [],
        },
      ])
      assert.equal((await read())[0]?.gpsValid, false)
      assert.equal((await read())[0]?.latitude, 44)
      assert.equal((await read())[0]?.address, 'New address')
      await apply(
        [
          {
            ...asset,
            name: 'Preview name',
            observations: [{ ...newer, observedAt: new Date(at.getTime() + 4000).toISOString() }],
            lastReportedAt: new Date(at.getTime() + 4000).toISOString(),
          },
        ],
        true,
      )
      assert.equal((await read())[0]?.name, 'Source name')
      assert.equal((await withTenant(app.db, a, (tx) => tx.select().from(history))).length, 2)
      await assert.rejects(
        () => apply([{ ...asset, observations: [{ ...point, latitude: 91 }] }]),
        /coordinates/,
      )
      assert.equal((await read())[0]?.sourcePresent, true)
      await apply([{ ...asset, externalId: 'source-c' }])
      assert.equal((await read())[0]?.sourcePresent, false)
      assert.equal((await read())[0]?.itemId, itemId)
      assert.deepEqual(
        await withTenant(app.db, b, (tx) =>
          tx.select().from(inventory).where(eq(inventory.id, first.id)),
        ),
        [],
      )
      await assert.rejects(() =>
        withTenant(app.db, a, (tx) =>
          tx.update(inventory).set({ itemId: otherItem }).where(eq(inventory.id, first.id)),
        ),
      )
      await assert.rejects(() =>
        withTenant(app.db, a, (tx) =>
          tx
            .update(inventory)
            .set({ connectionId: otherConnection })
            .where(eq(inventory.id, first.id)),
        ),
      )
      const [other] = await withTenant(app.db, a, (tx) =>
        tx
          .select()
          .from(inventory)
          .where(
            and(eq(inventory.connectionId, connectionId), eq(inventory.externalId, 'source-c')),
          ),
      )
      assert.ok(other)
      await assert.rejects(() =>
        withTenant(app.db, a, (tx) =>
          tx.update(inventory).set({ itemId, boundAt: at }).where(eq(inventory.id, other.id)),
        ),
      )
      await assert.rejects(() =>
        withTenant(app.db, a, (tx) =>
          tx.update(inventory).set({ excluded: true }).where(eq(inventory.id, first.id)),
        ),
      )
      await withTenant(app.db, a, (tx) =>
        tx.insert(syncRuns).values({
          tenantId: a,
          connectionId,
          trigger: 'preview',
          dryRun: true,
          status: 'running',
        }),
      )
      const blocked = await runSync({ db: app.db, tenantId: a, connectionId, trigger: 'manual' })
      assert.equal(blocked.status, 'error')
      assert.match(blocked.error ?? '', /already running/)
      assert.equal((await withTenant(app.db, a, (tx) => tx.select().from(syncRuns))).length, 1)
      await withTenant(app.db, a, (tx) =>
        tx
          .update(syncConnections)
          .set({ deletedAt: new Date() })
          .where(eq(syncConnections.id, connectionId)),
      )
      await assert.rejects(() => apply([asset]), /deleted during this run/)
    } finally {
      await admin.db.delete(tenants).where(eq(tenants.id, a))
      await admin.db.delete(tenants).where(eq(tenants.id, b))
      await app.sql.end()
      await admin.sql.end()
    }
  },
)
