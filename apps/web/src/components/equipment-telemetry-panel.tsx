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
import { mergeHref, parsePrefixedListParams, pickString } from '@/lib/list-params'
import { formatDateTime } from '@/lib/datetime'
import { TELEMETRY_HEALTH_LABELS, telemetryHealthSql } from '@/lib/equipment/telemetry'
import { EquipmentTelemetryMap, type EquipmentMapPoint } from './equipment-telemetry-map'
import { SearchInput } from './search-input'
import { FilterChips } from './filter-bar'
import { Pagination } from './pagination'
import { TabNav, pickActiveTab } from './tab-nav'

export async function EquipmentTelemetryPanel({
  itemId,
  trackerId,
  basePath,
  searchParams,
  view,
}: {
  itemId?: string
  trackerId?: string
  basePath: string
  searchParams: Record<string, string | string[] | undefined>
  view?: 'map' | 'history' | 'details'
}) {
  const activeView =
    view ??
    pickActiveTab(searchParams, ['map', 'history', 'details'] as const, 'map', 'trackerView')
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
  const points: EquipmentMapPoint[] = []
  if (asset.latitude !== null && asset.longitude !== null && asset.locationObservedAt) {
    const latestPoint = {
      id: asset.id,
      label: asset.name,
      latitude: asset.latitude,
      longitude: asset.longitude,
      observedAt: asset.locationObservedAt.toISOString(),
      observedLabel: time(asset.locationObservedAt),
      health: TELEMETRY_HEALTH_LABELS[health],
      href: mergeHref(basePath, searchParams, {}),
      address: asset.address,
      source: data.sourceName,
      speedKph: asset.speedKph,
    }
    points.push(latestPoint)
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
    <div className="space-y-4">
      {!view ? (
        <TabNav
          variant="pills"
          basePath={basePath}
          currentParams={searchParams}
          paramKey="trackerView"
          active={activeView}
          tabs={[
            { key: 'map', label: 'Map' },
            { key: 'history', label: 'GPS history' },
            { key: 'details', label: 'Tracker details' },
          ]}
        />
      ) : null}
      {activeView === 'map' ? (
        points.length ? (
          <EquipmentTelemetryMap
            points={points}
            compact
            footer={
              <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium break-words">
                    <GeneratedValue
                      value={
                        asset.address ||
                        `${asset.latitude?.toFixed(5)}, ${asset.longitude?.toFixed(5)}`
                      }
                    />
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    <GeneratedValue value={'GPS observed'} />: {time(asset.locationObservedAt)}
                    <span className="mx-2">·</span>
                    {data.sourceName}
                  </p>
                </div>
                <Badge>
                  <GeneratedValue value={TELEMETRY_HEALTH_LABELS[health]} />
                </Badge>
              </div>
            }
          />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-slate-500">
              <GeneratedValue
                value={
                  'This tracker has not supplied a valid position. Open Tracker details to check its connection and reporting times.'
                }
              />
            </CardContent>
          </Card>
        )
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>
                  <GeneratedValue
                    value={activeView === 'history' ? 'GPS history' : 'Tracker details'}
                  />
                  {activeView === 'history' ? (
                    <span className="ml-1 font-normal text-slate-500">({data.total})</span>
                  ) : null}
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
          <CardContent className="space-y-4">
            {activeView === 'details' ? (
              <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {details.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-xs text-slate-500">
                      <GeneratedValue value={label} />
                    </dt>
                    <dd className="mt-1 font-medium break-words">
                      <GeneratedValue value={value} />
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <>
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
                        <tr
                          key={point.id}
                          className="border-b border-slate-100 dark:border-slate-800"
                        >
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
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
