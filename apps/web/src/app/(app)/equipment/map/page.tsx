import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Activity, ArrowUpRight, MapPin, Radio, Satellite, TriangleAlert } from 'lucide-react'
import { and, asc, count, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import {
  equipmentItems,
  equipmentTelemetryAssets as assets,
  orgUnits,
  people,
  syncConnections,
} from '@beaconhs/db/schema'
import { can } from '@beaconhs/tenant'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { moduleScopeWhere } from '@/lib/visibility'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { formatDateTime } from '@/lib/datetime'
import { TELEMETRY_HEALTH_LABELS, telemetryHealthSql } from '@/lib/equipment/telemetry'
import { PageContainer } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { EquipmentTelemetryMap } from '@/components/equipment-telemetry-map'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TabNav, pickActiveTab } from '@/components/tab-nav'

export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('Equipment map') }
}

export default async function EquipmentLocationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const t = await getGeneratedValueTranslations()
  const ctx = await requireRequestContext()
  const time = (date: Date | null) => (date ? formatDateTime(date, ctx.timezone, ctx.locale) : '—')
  if (!can(ctx, 'equipment.read.self')) redirect('/equipment')
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 100,
    allowedSorts: ['name'],
  })
  const view = pickActiveTab(sp, ['map', 'table'] as const, 'map', 'view')
  const health = pickString(sp.health)
  const motion = pickString(sp.motion)
  const source = pickString(sp.source)
  const data = await ctx.db(async (tx) => {
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
    const summary = await tx
      .select({
        health: telemetryHealthSql,
        count: count(),
        unplaced: sql<number>`count(*) filter (where ${assets.latitude} is null)`,
      })
      .from(assets)
      .innerJoin(equipmentItems, eq(equipmentItems.id, assets.itemId))
      .innerJoin(syncConnections, eq(syncConnections.id, assets.connectionId))
      .where(visible)
      .groupBy(telemetryHealthSql)
    const sources = await tx
      .selectDistinct({ id: syncConnections.id, name: syncConnections.name })
      .from(assets)
      .innerJoin(equipmentItems, eq(equipmentItems.id, assets.itemId))
      .innerJoin(syncConnections, eq(syncConnections.id, assets.connectionId))
      .where(visible)
      .orderBy(asc(syncConnections.name))
    return { rows, sources, summary, total: Number(total?.count ?? 0) }
  })
  const tracked = data.summary.reduce((sum, row) => sum + Number(row.count), 0)
  const reporting = Number(data.summary.find((row) => row.health === 'fresh')?.count ?? 0)
  const unplaced = data.summary.reduce((sum, row) => sum + Number(row.unplaced), 0)
  const points = data.rows.flatMap(({ asset, item, health, connectionName }) =>
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
  const stats = [
    { label: 'Tracked equipment', value: tracked, icon: Radio },
    { label: 'Reporting', value: reporting, icon: Activity },
    { label: 'Needs attention', value: tracked - reporting, icon: TriangleAlert },
    { label: 'Without a position', value: unplaced, icon: Satellite },
  ]
  return (
    <PageContainer>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              <GeneratedValue value={'Equipment map'} />
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              <GeneratedValue
                value={
                  'Your equipment, on the map. Every position includes its original observation time.'
                }
              />
            </p>
          </div>
          {can(ctx, 'admin.integrations.manage') ? (
            <Link href="/admin/integrations">
              <Button variant="outline">
                <GeneratedValue value={'Manage integrations'} />
                <ArrowUpRight size={15} />
              </Button>
            </Link>
          ) : null}
        </div>
        <EquipmentSubNav active="map" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>
                  <GeneratedValue value={label} />
                </span>
                <Icon size={16} className="text-teal-600 dark:text-teal-400" />
              </div>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput placeholder={t('Search equipment, tracker, address or manual site')} />
          <FilterChips
            basePath="/equipment/map"
            currentParams={sp}
            paramKey="health"
            label={t('Tracker health')}
            options={Object.entries(TELEMETRY_HEALTH_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <FilterChips
            basePath="/equipment/map"
            currentParams={sp}
            paramKey="motion"
            label={t('Movement')}
            options={[
              { value: 'moving', label: 'Moving' },
              { value: 'stationary', label: 'Stationary' },
            ]}
          />
          <FilterChips
            basePath="/equipment/map"
            currentParams={sp}
            paramKey="source"
            label={t('Source')}
            options={data.sources.map((row) => ({ value: row.id, label: row.name }))}
          />
          <FilterChips
            basePath="/equipment/map"
            currentParams={sp}
            paramKey="perPage"
            label={t('Rows')}
            defaultValue="100"
            hideAll
            options={[
              { value: '25', label: '25' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
            ]}
          />
        </div>
        <TabNav
          variant="pills"
          basePath="/equipment/map"
          currentParams={sp}
          paramKey="view"
          active={view}
          tabs={[
            { key: 'map', label: 'Map' },
            { key: 'table', label: 'Table', count: data.total },
          ]}
        />
        {view === 'map' ? (
          <div className="space-y-3">
            {points.length ? (
              <EquipmentTelemetryMap points={points} large />
            ) : (
              <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-900">
                <MapPin size={36} className="text-slate-400" />
                <p className="font-medium">
                  <GeneratedValue value={'No positions to show'} />
                </p>
                <p className="max-w-lg text-sm text-slate-500">
                  <GeneratedValue
                    value={
                      'Choose Table to see equipment without a valid GPS fix. An administrator can retrieve trackers and link them under Integrations.'
                    }
                  />
                </p>
              </div>
            )}
            <p className="text-xs text-slate-500">
              <GeneratedValue value={'Available positions:'} /> {points.length}.{' '}
              <GeneratedValue value={'Matching equipment:'} /> {data.total}.{' '}
              <GeneratedValue
                value={
                  'Search, filters and pagination update both the map and list. GPS supplements manual location and custody.'
                }
              />
            </p>
            <Pagination
              basePath="/equipment/map"
              currentParams={sp}
              total={data.total}
              page={params.page}
              perPage={params.perPage}
            />
          </div>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>
                <GeneratedValue value={'Location details'} />{' '}
                <span className="font-normal text-slate-500">({data.total})</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700">
                      <th className="p-3">
                        <GeneratedValue value={'Equipment / source'} />
                      </th>
                      <th className="p-3">
                        <GeneratedValue value={'Tracker health'} />
                      </th>
                      <th className="p-3">
                        <GeneratedValue value={'Last known position'} />
                      </th>
                      <th className="p-3">
                        <GeneratedValue value={'GPS observed / contact'} />
                      </th>
                      <th className="p-3">
                        <GeneratedValue value={'Movement'} />
                      </th>
                      <th className="p-3">
                        <GeneratedValue value={'Manual site / holder'} />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map(
                      ({
                        asset,
                        item,
                        connectionName,
                        health,
                        siteName,
                        holderFirstName,
                        holderLastName,
                      }) => (
                        <tr
                          key={asset.id}
                          className="border-b border-slate-100 align-top dark:border-slate-800"
                        >
                          <td className="p-3">
                            <Link
                              className="font-semibold text-teal-700 hover:underline dark:text-teal-400"
                              href={`/equipment/${item.id}?tab=location`}
                            >
                              {item.assetTag} · {item.name}
                            </Link>
                            <p className="mt-1 text-xs text-slate-500">
                              {connectionName} · {asset.name}
                            </p>
                          </td>
                          <td className="p-3">
                            <Badge>
                              <GeneratedValue value={TELEMETRY_HEALTH_LABELS[health]} />
                            </Badge>
                            <p className="mt-1 text-xs text-slate-500">
                              <GeneratedValue
                                value={asset.deviceModels.join(', ') || 'No device model'}
                              />
                            </p>
                          </td>
                          <td className="min-w-48 p-3">
                            <p>
                              <GeneratedValue value={asset.address || 'Address unavailable'} />
                            </p>
                            <p className="mt-1 font-mono text-xs text-slate-500">
                              <GeneratedValue
                                value={
                                  asset.latitude !== null && asset.longitude !== null
                                    ? `${asset.latitude.toFixed(5)}, ${asset.longitude.toFixed(5)}`
                                    : 'No valid GPS fix'
                                }
                              />
                            </p>
                          </td>
                          <td className="p-3 whitespace-nowrap">
                            <p>{time(asset.locationObservedAt)}</p>
                            <p className="mt-1 text-xs text-slate-500">
                              <GeneratedValue value={'Contact:'} /> {time(asset.lastReportedAt)}
                            </p>
                          </td>
                          <td className="p-3">
                            <p>
                              <GeneratedValue
                                value={
                                  asset.speedKph === null
                                    ? 'Unknown speed'
                                    : `${asset.speedKph.toFixed(1)} km/h`
                                }
                              />
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              <GeneratedValue value={'Engine'} />{' '}
                              <GeneratedValue
                                value={
                                  asset.engineOn === null
                                    ? 'unknown'
                                    : asset.engineOn
                                      ? 'on'
                                      : 'off'
                                }
                              />
                            </p>
                          </td>
                          <td className="p-3">
                            <p>
                              <GeneratedValue value={siteName || 'No manual site'} />
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              <GeneratedValue
                                value={
                                  holderFirstName
                                    ? [holderFirstName, holderLastName].join(' ')
                                    : 'No current holder'
                                }
                              />
                            </p>
                          </td>
                        </tr>
                      ),
                    )}
                    {!data.rows.length ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-500">
                          <GeneratedValue value={'No linked equipment matches these filters.'} />
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <Pagination
                basePath="/equipment/map"
                currentParams={sp}
                total={data.total}
                page={params.page}
                perPage={params.perPage}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </PageContainer>
  )
}
