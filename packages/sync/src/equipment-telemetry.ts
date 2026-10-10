import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '@beaconhs/db'
import {
  equipmentTelemetryAssets,
  equipmentTelemetryObservations,
  syncConnections,
  type SyncRecordAction,
} from '@beaconhs/db/schema'
import type { EquipmentTelemetryAsset, EquipmentTelemetryObservation } from './types'

function date(value: string): Date {
  const result = new Date(value)
  if (!Number.isFinite(result.getTime()) || result.getTime() > Date.now() + 300_000)
    throw new Error('Invalid telemetry observation time.')
  return result
}

export function orderedTelemetryObservations(
  points: EquipmentTelemetryObservation[],
): EquipmentTelemetryObservation[] {
  const observations = new Map<string, EquipmentTelemetryObservation>()
  for (const point of points) {
    const observedAt = date(point.observedAt).toISOString()
    if (
      !Number.isFinite(point.latitude) ||
      Math.abs(point.latitude) > 90 ||
      !Number.isFinite(point.longitude) ||
      Math.abs(point.longitude) > 180
    )
      throw new Error('Invalid telemetry coordinates.')
    if (point.speedKph !== null && (!Number.isFinite(point.speedKph) || point.speedKph < 0))
      throw new Error('Invalid telemetry speed.')
    const existing = observations.get(observedAt)
    if (
      existing &&
      (existing.latitude !== point.latitude || existing.longitude !== point.longitude)
    )
      throw new Error('Conflicting telemetry coordinates for the same observation time.')
    observations.set(observedAt, { ...point, observedAt })
  }
  return [...observations.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt))
}

export async function applyEquipmentTelemetry(
  tx: Database,
  args: {
    tenantId: string
    connectionId: string
    assets: EquipmentTelemetryAsset[]
    dryRun: boolean
  },
): Promise<
  Array<{
    externalId: string
    canonicalId: string | null
    action: SyncRecordAction
    message: string
  }>
> {
  const { tenantId, connectionId, assets, dryRun } = args
  if (!assets.length)
    throw new Error('An empty telemetry inventory cannot replace existing trackers.')
  const unique = new Set(assets.map((a) => a.externalId))
  if (unique.size !== assets.length || assets.some((a) => !a.externalId || !a.name))
    throw new Error('Invalid telemetry asset inventory.')
  // Lock the connection for the short persistence transaction. Scheduled,
  // manual and preview reads can overlap, but inventory writes cannot race.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`telemetry:${tenantId}:${connectionId}`}, 0))`,
  )
  const [connection] = await tx
    .select({ id: syncConnections.id })
    .from(syncConnections)
    .where(and(eq(syncConnections.id, connectionId), isNull(syncConnections.deletedAt)))
    .limit(1)
  if (!connection) throw new Error('The tracking integration was deleted during this run.')
  const decisions: Array<{
    externalId: string
    canonicalId: string | null
    action: SyncRecordAction
    message: string
  }> = []
  if (!dryRun)
    await tx
      .update(equipmentTelemetryAssets)
      .set({ sourcePresent: false })
      .where(eq(equipmentTelemetryAssets.connectionId, connectionId))
  for (const asset of assets) {
    const points = orderedTelemetryObservations(asset.observations)
    const latest = points.at(-1)
    const reportedAt = asset.lastReportedAt ? date(asset.lastReportedAt) : null
    if (latest && (!reportedAt || date(latest.observedAt) > reportedAt))
      throw new Error('Telemetry location is newer than the source report.')
    const [existing] = await tx
      .select()
      .from(equipmentTelemetryAssets)
      .where(
        and(
          eq(equipmentTelemetryAssets.connectionId, connectionId),
          eq(equipmentTelemetryAssets.externalId, asset.externalId),
        ),
      )
      .limit(1)
    const newerLocation =
      latest &&
      (!existing?.locationObservedAt || date(latest.observedAt) > existing.locationObservedAt)
    const newerReport =
      reportedAt && (!existing?.lastReportedAt || reportedAt >= existing.lastReportedAt)
    const values = {
      tenantId,
      connectionId,
      externalId: asset.externalId,
      name: asset.name,
      vin: asset.vin,
      deviceSerials: asset.deviceSerials,
      deviceModels: asset.deviceModels,
      deactivated: asset.deactivated,
      sourcePresent: true,
      ingestedAt: new Date(),
      lastReportedAt: newerReport ? reportedAt : (existing?.lastReportedAt ?? null),
      gpsValid: newerReport ? asset.gpsValid : (existing?.gpsValid ?? false),
      address:
        newerLocation ||
        (latest && date(latest.observedAt).getTime() === existing?.locationObservedAt?.getTime())
          ? asset.address
          : (existing?.address ?? null),
      latitude: newerLocation ? latest.latitude : (existing?.latitude ?? null),
      longitude: newerLocation ? latest.longitude : (existing?.longitude ?? null),
      locationObservedAt: newerLocation
        ? date(latest.observedAt)
        : (existing?.locationObservedAt ?? null),
      speedKph: newerLocation ? latest.speedKph : (existing?.speedKph ?? null),
      engineOn: newerLocation ? latest.engineOn : (existing?.engineOn ?? null),
    }
    const changed =
      newerLocation ||
      (newerReport && reportedAt?.getTime() !== existing?.lastReportedAt?.getTime()) ||
      existing?.name !== asset.name ||
      !existing?.sourcePresent ||
      existing?.deactivated !== asset.deactivated
    const action: SyncRecordAction = !existing ? 'created' : changed ? 'updated' : 'unchanged'
    decisions.push({
      externalId: asset.externalId,
      canonicalId: existing?.itemId ?? null,
      action,
      message: `${points.length} valid location observation(s); ${existing?.itemId ? 'equipment linked' : 'equipment mapping required'}.`,
    })
    if (dryRun) continue
    const [saved] = await tx
      .insert(equipmentTelemetryAssets)
      .values(values)
      .onConflictDoUpdate({
        target: [
          equipmentTelemetryAssets.tenantId,
          equipmentTelemetryAssets.connectionId,
          equipmentTelemetryAssets.externalId,
        ],
        set: values,
      })
      .returning({ id: equipmentTelemetryAssets.id })
    if (!saved) throw new Error('Could not save telemetry asset.')
    // History imported before a tracker assignment stays unassigned. GPS
    // cannot establish who held an item before its binding became effective.
    for (let offset = 0; offset < points.length; offset += 250) {
      const batch = points.slice(offset, offset + 250)
      if (batch.length)
        await tx
          .insert(equipmentTelemetryObservations)
          .values(
            batch.map((point) => ({
              tenantId,
              telemetryAssetId: saved.id,
              itemId:
                existing?.itemId && existing.boundAt && date(point.observedAt) >= existing.boundAt
                  ? existing.itemId
                  : null,
              observedAt: date(point.observedAt),
              latitude: point.latitude,
              longitude: point.longitude,
              speedKph: point.speedKph,
              engineOn: point.engineOn,
            })),
          )
          .onConflictDoNothing({
            target: [
              equipmentTelemetryObservations.tenantId,
              equipmentTelemetryObservations.telemetryAssetId,
              equipmentTelemetryObservations.observedAt,
            ],
          })
    }
  }
  return decisions
}
