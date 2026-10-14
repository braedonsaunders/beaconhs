import { and, asc, count, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import {
  equipmentItems,
  equipmentTelemetryAssets as assets,
  orgUnits,
  people,
  syncConnections,
} from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { moduleScopeWhere } from '@beaconhs/tenant/visibility'
import { isUuid } from '@/lib/list-params'
import { formatDateTime } from '@/lib/datetime'
import { TELEMETRY_HEALTH_LABELS, telemetryHealthSql } from './telemetry'

/** Shared tenant/scoped, paginated tracker query for the map and dashboard. */
export async function loadEquipmentMap(
  ctx: RequestContext,
  params: { q?: string; page: number; perPage: number },
  filters: { health?: string; motion?: string; source?: string } = {},
) {
  const { health, motion, source } = filters
  return ctx.db(async (tx) => {
    const scope = await moduleScopeWhere(ctx, tx, {
      prefix: 'equipment',
      siteCol: equipmentItems.currentSiteOrgUnitId,
      personCol: equipmentItems.currentHolderPersonId,
    })
    const visible = and(
      isNull(equipmentItems.deletedAt),
      isNull(syncConnections.deletedAt),
      eq(assets.excluded, false),
      scope,
    )
    const where = and(
      visible,
      params.q
        ? or(
            ilike(equipmentItems.assetTag, `%${params.q}%`),
            ilike(equipmentItems.name, `%${params.q}%`),
            ilike(assets.name, `%${params.q}%`),
            ilike(assets.address, `%${params.q}%`),
            ilike(orgUnits.name, `%${params.q}%`),
          )
        : undefined,
      health && Object.hasOwn(TELEMETRY_HEALTH_LABELS, health)
        ? eq(telemetryHealthSql, health as keyof typeof TELEMETRY_HEALTH_LABELS)
        : undefined,
      motion === 'moving'
        ? sql`${assets.speedKph} > 0`
        : motion === 'stationary'
          ? eq(assets.speedKph, 0)
          : undefined,
      source && isUuid(source) ? eq(syncConnections.id, source) : undefined,
    )
    const query = () =>
      tx
        .select({
          asset: assets,
          item: equipmentItems,
          connectionName: syncConnections.name,
          health: telemetryHealthSql,
          siteName: orgUnits.name,
          holderFirstName: people.firstName,
          holderLastName: people.lastName,
        })
        .from(assets)
        .innerJoin(equipmentItems, eq(equipmentItems.id, assets.itemId))
        .innerJoin(syncConnections, eq(syncConnections.id, assets.connectionId))
        .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
        .leftJoin(people, eq(people.id, equipmentItems.currentHolderPersonId))
        .where(where)
    const rows = await query()
      .orderBy(asc(equipmentItems.assetTag), asc(assets.id))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const [total] = await tx
      .select({ count: count() })
      .from(assets)
      .innerJoin(equipmentItems, eq(equipmentItems.id, assets.itemId))
      .innerJoin(syncConnections, eq(syncConnections.id, assets.connectionId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentItems.currentSiteOrgUnitId))
      .where(where)
    const sources = await tx
      .selectDistinct({ id: syncConnections.id, name: syncConnections.name })
      .from(assets)
      .innerJoin(equipmentItems, eq(equipmentItems.id, assets.itemId))
      .innerJoin(syncConnections, eq(syncConnections.id, assets.connectionId))
      .where(visible)
      .orderBy(asc(syncConnections.name))
    return { rows, sources, total: Number(total?.count ?? 0) }
  })
}

export function equipmentMapPoints(
  data: Awaited<ReturnType<typeof loadEquipmentMap>>,
  ctx: RequestContext,
) {
  const time = (date: Date) => formatDateTime(date, ctx.timezone, ctx.locale)
  return data.rows.flatMap(({ asset, item, health, connectionName }) =>
    asset.latitude !== null && asset.longitude !== null && asset.locationObservedAt
      ? [
          {
            id: asset.id,
            label: item.assetTag + ' · ' + item.name,
            latitude: asset.latitude,
            longitude: asset.longitude,
            observedAt: asset.locationObservedAt.toISOString(),
            observedLabel: time(asset.locationObservedAt),
            health: TELEMETRY_HEALTH_LABELS[health],
            href: `/equipment/${item.id}?tab=location`,
            address: asset.address,
            source: connectionName,
            speedKph: asset.speedKph,
          },
        ]
      : [],
  )
}
