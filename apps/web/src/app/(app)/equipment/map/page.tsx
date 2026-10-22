import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, MapPin } from 'lucide-react'
import { can } from '@beaconhs/tenant'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, PageHeader } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { parseListParams, pickString } from '@/lib/list-params'
import { formatDateTime } from '@/lib/datetime'
import { TELEMETRY_HEALTH_LABELS } from '@/lib/equipment/telemetry'
import { loadEquipmentMap, equipmentMapPoints } from '@/lib/equipment/map-data'
import { ListPageLayout } from '@/components/page-layout'
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
  const data = await loadEquipmentMap(ctx, params, { health, motion, source })
  const points = equipmentMapPoints(data, ctx)
  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={t('Equipment map')}
            description={t(
              'Your equipment, on the map. Every position includes its original observation time.',
            )}
            actions={
              can(ctx, 'admin.integrations.manage') ? (
                <Link href="/admin/integrations">
                  <Button variant="outline">
                    <GeneratedValue value="Manage integrations" />
                    <ArrowUpRight size={15} />
                  </Button>
                </Link>
              ) : undefined
            }
          />
          <EquipmentSubNav active="map" />
          <div className="flex flex-wrap items-start gap-2">
            <SearchInput
              className="relative min-w-0 flex-1 lg:w-72 lg:flex-none"
              placeholder={t('Search equipment, tracker, address or manual site')}
            />
            <div className="order-2 flex w-full min-w-0 flex-wrap items-center gap-2 lg:order-none lg:w-auto lg:flex-1">
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
              className="ml-auto shrink-0 pb-0 sm:pb-0"
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
          </div>
        </>
      }
    >
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
                                asset.engineOn === null ? 'unknown' : asset.engineOn ? 'on' : 'off'
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
    </ListPageLayout>
  )
}
