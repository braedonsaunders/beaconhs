import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import { and, asc, count, desc, eq, gt, ilike, isNull, sql } from 'drizzle-orm'
import {
  equipmentItems,
  equipmentTelemetryAssets as assets,
  equipmentTelemetryObservations as observations,
  syncConnections,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { parsePrefixedListParams, pickString } from '@/lib/list-params'
import { formatDateTime } from '@/lib/datetime'
import { TELEMETRY_HEALTH_LABELS, telemetryHealthSql } from '@/lib/equipment/telemetry'
import { EquipmentTelemetryMap, type EquipmentMapPoint } from './equipment-telemetry-map'
import { SearchInput } from './search-input'
import { FilterChips } from './filter-bar'
import { Pagination } from './pagination'

export async function EquipmentTelemetryPanel({
  itemId,
  trackerId,
  basePath,
  searchParams,
}: {
  itemId?: string
  trackerId?: string
  basePath: string
  searchParams: Record<string, string | string[] | undefined>
}) {
  const t = await getGeneratedValueTranslations()
  const ctx = await requireRequestContext()
  const time = (date: Date | null) => (date ? formatDateTime(date, ctx.timezone, ctx.locale) : '—')
  if (trackerId) assertCan(ctx, 'admin.integrations.manage')
  else assertCan(ctx, 'equipment.read.self')
  const params = parsePrefixedListParams(searchParams, 'gps', {
    sort: 'observed',
    dir: 'desc',
    perPage: 15,
    allowedSorts: ['observed'],
  })
  const motion = pickString(searchParams.gpsMotion)
  const data = await ctx.db(async (tx) => {
    const scope = itemId
      ? await moduleScopeWhere(ctx, tx, {
          prefix: 'equipment',
          siteCol: equipmentItems.currentSiteOrgUnitId,
          personCol: equipmentItems.currentHolderPersonId,
        })
      : undefined
    const where = and(
      trackerId ? eq(assets.id, trackerId) : itemId ? eq(assets.itemId, itemId) : sql`false`,
      isNull(syncConnections.deletedAt),
      itemId ? isNull(equipmentItems.deletedAt) : undefined,
      scope,
    )
    const [row] = await tx
      .select({ asset: assets, sourceName: syncConnections.name, health: telemetryHealthSql })
      .from(assets)
      .innerJoin(syncConnections, eq(syncConnections.id, assets.connectionId))
      .leftJoin(equipmentItems, eq(equipmentItems.id, assets.itemId))
      .where(where)
      .limit(1)
    if (!row) return null
    const historyWhere = and(
      trackerId ? eq(observations.telemetryAssetId, trackerId) : eq(observations.itemId, itemId!),
      params.q
        ? ilike(
            sql<string>`to_char(${observations.observedAt} AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI')`,
            `%${params.q}%`,
          )
        : undefined,
      motion === 'moving'
        ? gt(observations.speedKph, 0)
        : motion === 'stationary'
          ? eq(observations.speedKph, 0)
          : undefined,
    )
    const history = await tx
      .select()
      .from(observations)
      .where(historyWhere)
      .orderBy(desc(observations.observedAt), asc(observations.id))
      .limit(params.perPage)
      .offset((params.page - 1) * params.perPage)
    const [total] = await tx.select({ count: count() }).from(observations).where(historyWhere)
    return { ...row, history, total: Number(total?.count ?? 0) }
  })
  if (!data) return null
  const { asset, health } = data
  const points: EquipmentMapPoint[] = data.history
    .slice()
    .reverse()
    .map((point) => ({
      id: point.id,
      label: asset.name,
      latitude: point.latitude,
      longitude: point.longitude,
      observedAt: point.observedAt.toISOString(),
      observedLabel: time(point.observedAt),
      health: 'Historical observation',
      href: basePath,
    }))
  if (asset.latitude !== null && asset.longitude !== null && asset.locationObservedAt) {
    const latestPoint = {
      id: asset.id,
      label: asset.name,
      latitude: asset.latitude,
      longitude: asset.longitude,
      observedAt: asset.locationObservedAt.toISOString(),
      observedLabel: time(asset.locationObservedAt),
      health: TELEMETRY_HEALTH_LABELS[health],
      href: basePath,
      address: asset.address,
      source: data.sourceName,
      speedKph: asset.speedKph,
    }
    const index = points.findIndex((point) => point.observedAt === latestPoint.observedAt)
    if (index >= 0) points[index] = latestPoint
    else points.push(latestPoint)
  }
  const details = [
    ['GPS observed', time(asset.locationObservedAt)],
    ['Last tracker contact', time(asset.lastReportedAt)],
    ['Last successful ingestion', time(asset.ingestedAt)],
    [
      'Coordinates',
      asset.latitude !== null && asset.longitude !== null
        ? `${asset.latitude.toFixed(6)}, ${asset.longitude.toFixed(6)}`
        : 'No valid GPS fix',
    ],
    [
      'Speed at last position',
      asset.speedKph === null ? 'Unknown' : `${asset.speedKph.toFixed(1)} km/h`,
    ],
    [
      'Engine at last position',
      asset.engineOn === null ? 'Unknown' : asset.engineOn ? 'On' : 'Off',
    ],
    ['Tracker devices', asset.deviceModels.join(', ') || 'No assigned model'],
    ['Device serials', asset.deviceSerials.join(', ') || 'No assigned device'],
    ['Source VIN', asset.vin || 'Not supplied'],
    ['Linked to equipment', time(asset.boundAt)],
  ]
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>
              <GeneratedValue value={'Tracker location'} />
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500">
              {data.sourceName} · {asset.name}
            </p>
          </div>
          <Badge>
            <GeneratedValue value={TELEMETRY_HEALTH_LABELS[health]} />
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl bg-teal-50 px-4 py-3 dark:bg-teal-950/50">
          <p className="text-xs font-medium tracking-wide text-teal-700 uppercase dark:text-teal-400">
            <GeneratedValue value={'Last known position'} />
          </p>
          <p className="mt-1 font-medium">
            <GeneratedValue
              value={
                asset.address ||
                (asset.latitude !== null && asset.longitude !== null
                  ? `${asset.latitude.toFixed(5)}, ${asset.longitude.toFixed(5)}`
                  : 'Awaiting a valid GPS fix')
              }
            />
          </p>
          <p className="mt-1 text-xs text-slate-500">
            <GeneratedValue value={'Observed'} /> {time(asset.locationObservedAt)}
            <GeneratedValue
              value={'. Always check this time before relying on a retained position.'}
            />
          </p>
        </div>
        {points.length ? (
          <EquipmentTelemetryMap points={points} trail />
        ) : (
          <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
            <GeneratedValue
              value={
                'This tracker has not supplied a valid position. Its connection and reporting details remain available below.'
              }
            />
          </p>
        )}
        <dl className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 p-4 text-sm lg:grid-cols-3 dark:border-slate-800">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-slate-500">
                <GeneratedValue value={label} />
              </dt>
              <dd className="mt-1 font-medium break-words">
                <GeneratedValue value={value} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-slate-500">
          <GeneratedValue
            value={
              'GPS readings supplement manual location and custody. The map includes the latest known position and this page of history. History records which equipment was linked when the reading occurred.'
            }
          />
        </p>
        <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
          <h3 className="font-semibold">
            <GeneratedValue value={'Location history'} />{' '}
            <span className="font-normal text-slate-500">({data.total})</span>
          </h3>
        </div>
        <SearchInput
          placeholder={t('Search GPS history date or time (UTC)')}
          paramKey="gpsQ"
          pageParamKey="gpsPage"
        />
        <FilterChips
          basePath={basePath}
          currentParams={searchParams}
          paramKey="gpsMotion"
          label={t('Movement')}
          options={[
            { value: 'moving', label: 'Moving' },
            { value: 'stationary', label: 'Stationary' },
          ]}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="p-2">
                  <GeneratedValue value={'GPS observed'} />
                </th>
                <th className="p-2">
                  <GeneratedValue value={'Latitude'} />
                </th>
                <th className="p-2">
                  <GeneratedValue value={'Longitude'} />
                </th>
                <th className="p-2">
                  <GeneratedValue value={'Speed'} />
                </th>
                <th className="p-2">
                  <GeneratedValue value={'Engine'} />
                </th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((point) => (
                <tr key={point.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="p-2">{time(point.observedAt)}</td>
                  <td className="p-2">{point.latitude.toFixed(5)}</td>
                  <td className="p-2">{point.longitude.toFixed(5)}</td>
                  <td className="p-2">
                    <GeneratedValue
                      value={point.speedKph === null ? '—' : `${point.speedKph} km/h`}
                    />
                  </td>
                  <td className="p-2">
                    <GeneratedValue
                      value={point.engineOn === null ? '—' : point.engineOn ? 'On' : 'Off'}
                    />
                  </td>
                </tr>
              ))}
              {!data.history.length ? (
                <tr>
                  <td colSpan={5} className="p-4 text-center text-slate-500">
                    <GeneratedValue
                      value={
                        'No matching GPS history. Equipment history begins when its tracker link takes effect; earlier source history is available to administrators on the tracker record.'
                      }
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <Pagination
          basePath={basePath}
          currentParams={searchParams}
          total={data.total}
          page={params.page}
          perPage={params.perPage}
          pageParamKey="gpsPage"
        />
      </CardContent>
    </Card>
  )
}
