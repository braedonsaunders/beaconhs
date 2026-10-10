import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, asc, count, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
import {
  equipmentItems,
  equipmentTelemetryAssets as assets,
  syncConnections,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { getConnector } from '@beaconhs/sync'
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@beaconhs/ui'
import { requireRequestContext } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { isUuid, parseListParams, pickString } from '@/lib/list-params'
import { TELEMETRY_HEALTH_LABELS, telemetryHealthSql } from '@/lib/equipment/telemetry'
import { PageContainer } from '@/components/page-layout'
import { SearchInput } from '@/components/search-input'
import { FilterChips } from '@/components/filter-bar'
import { Pagination } from '@/components/pagination'
import { TrackerBinding } from './_binding'

export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('Tracker assignments') }
}

export default async function TrackerAssignmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  if (!isUuid(id)) notFound()
  const t = await getGeneratedValueTranslations()
  const ctx = await requireRequestContext()
  const time = (date: Date | null) => (date ? formatDateTime(date, ctx.timezone, ctx.locale) : '—')
  assertCan(ctx, 'admin.integrations.manage')
  const sp = await searchParams
  const listParams = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: ['name'],
  })
  const binding = pickString(sp.binding),
    health = pickString(sp.health)
  const data = await ctx.db(async (tx) => {
    const [connection] = await tx
      .select()
      .from(syncConnections)
      .where(and(eq(syncConnections.id, id), isNull(syncConnections.deletedAt)))
      .limit(1)
    if (!connection || !getConnector(connection.connectorKey)?.supportsEquipmentTelemetry)
      notFound()
    const where = and(
      eq(assets.connectionId, id),
      listParams.q
        ? or(
            ilike(assets.name, `%${listParams.q}%`),
            ilike(assets.vin, `%${listParams.q}%`),
            sql`${assets.deviceSerials}::text ILIKE ${`%${listParams.q}%`}`,
            ilike(equipmentItems.assetTag, `%${listParams.q}%`),
          )
        : undefined,
      binding === 'linked'
        ? isNotNull(assets.itemId)
        : binding === 'unmatched'
          ? and(isNull(assets.itemId), eq(assets.excluded, false))
          : binding === 'excluded'
            ? eq(assets.excluded, true)
            : undefined,
      health && Object.hasOwn(TELEMETRY_HEALTH_LABELS, health)
        ? eq(telemetryHealthSql, health as keyof typeof TELEMETRY_HEALTH_LABELS)
        : undefined,
    )
    const rows = await tx
      .select({ asset: assets, item: equipmentItems, health: telemetryHealthSql })
      .from(assets)
      .innerJoin(syncConnections, eq(syncConnections.id, assets.connectionId))
      .leftJoin(equipmentItems, eq(equipmentItems.id, assets.itemId))
      .where(where)
      .orderBy(asc(assets.name), asc(assets.id))
      .limit(listParams.perPage)
      .offset((listParams.page - 1) * listParams.perPage)
    const [total] = await tx
      .select({ count: count() })
      .from(assets)
      .innerJoin(syncConnections, eq(syncConnections.id, assets.connectionId))
      .leftJoin(equipmentItems, eq(equipmentItems.id, assets.itemId))
      .where(where)
    const suggestions = new Map<string, { id: string; label: string }>()
    for (const { asset } of rows) {
      if (asset.itemId || asset.excluded) continue
      const matches = await tx
        .select({
          id: equipmentItems.id,
          assetTag: equipmentItems.assetTag,
          name: equipmentItems.name,
        })
        .from(equipmentItems)
        .where(
          and(
            isNull(equipmentItems.deletedAt),
            or(
              sql`lower(trim(${equipmentItems.assetTag})) = ${asset.name.toLowerCase().trim()}`,
              asset.vin
                ? sql`lower(trim(${equipmentItems.vin})) = ${asset.vin.toLowerCase().trim()}`
                : undefined,
            ),
          ),
        )
        .limit(2)
      if (matches.length === 1 && matches[0])
        suggestions.set(asset.id, {
          id: matches[0].id,
          label: `${matches[0].assetTag} · ${matches[0].name}`,
        })
    }
    return { connection, rows, total: Number(total?.count ?? 0), suggestions }
  })
  const basePath = `/admin/integrations/${id}/trackers`
  return (
    <PageContainer>
      <div className="space-y-4">
        <Link
          href={`/admin/integrations/${id}`}
          className="text-sm text-teal-700 dark:text-teal-400"
        >
          <GeneratedValue value={'Back to integration'} />
        </Link>
        <h1 className="text-xl font-semibold">
          <GeneratedValue value={'Tracker assignments ·'} /> {data.connection.name}
        </h1>
        <p className="text-sm text-slate-500">
          <GeneratedValue
            value={
              'Link each source asset to existing equipment, or explicitly exclude it. Suggestions require review. Links do not change equipment details or manual custody. Historical readings before a new assignment stay with the tracker.'
            }
          />
        </p>
        {data.connection.lastError ? (
          <p
            role="alert"
            className="rounded border border-red-200 p-3 text-sm text-red-700 dark:border-red-800 dark:text-red-300"
          >
            {data.connection.lastError}
          </p>
        ) : null}
        <SearchInput placeholder={t('Search tracker name, serial, VIN or equipment tag')} />
        <FilterChips
          basePath={basePath}
          currentParams={sp}
          paramKey="binding"
          label={t('Assignment')}
          options={[
            { value: 'linked', label: 'Linked' },
            { value: 'unmatched', label: 'Needs mapping' },
            { value: 'excluded', label: 'Excluded' },
          ]}
        />
        <FilterChips
          basePath={basePath}
          currentParams={sp}
          paramKey="health"
          label={t('Tracker health')}
          options={Object.entries(TELEMETRY_HEALTH_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Card>
          <CardHeader>
            <CardTitle>
              <GeneratedValue value={'Trackers ('} />
              {data.total})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    <th className="p-2">
                      <GeneratedValue value={'Source asset'} />
                    </th>
                    <th className="p-2">
                      <GeneratedValue value={'Device'} />
                    </th>
                    <th className="p-2">
                      <GeneratedValue value={'Health / last contact'} />
                    </th>
                    <th className="p-2">
                      <GeneratedValue value={'Equipment assignment'} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map(({ asset, item, health }) => (
                    <tr
                      key={asset.id}
                      className="border-b border-slate-100 align-top dark:border-slate-800"
                    >
                      <td className="p-2">
                        <Link
                          href={`${basePath}/${asset.id}`}
                          className="text-teal-700 hover:underline dark:text-teal-400"
                        >
                          {asset.name}
                        </Link>
                        {asset.vin ? <p className="text-xs text-slate-500">{asset.vin}</p> : null}
                      </td>
                      <td className="p-2">
                        <GeneratedValue value={asset.deviceModels.join(', ') || 'No device'} />
                        <p className="text-xs text-slate-500">{asset.deviceSerials.join(', ')}</p>
                      </td>
                      <td className="space-y-1 p-2">
                        <Badge>
                          <GeneratedValue value={TELEMETRY_HEALTH_LABELS[health]} />
                        </Badge>
                        <p className="text-xs">{time(asset.lastReportedAt)}</p>
                      </td>
                      <td className="p-2">
                        <TrackerBinding
                          key={`${asset.id}:${asset.itemId}:${asset.excluded}`}
                          trackerId={asset.id}
                          itemId={asset.itemId}
                          itemLabel={item ? `${item.assetTag} · ${item.name}` : null}
                          excluded={asset.excluded}
                          suggestion={data.suggestions.get(asset.id) ?? null}
                        />
                      </td>
                    </tr>
                  ))}
                  {!data.rows.length ? (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-slate-500">
                        <GeneratedValue
                          value={
                            'No trackers match. Save credentials and use Run now on the integration to retrieve its inventory.'
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
              currentParams={sp}
              total={data.total}
              page={listParams.page}
              perPage={listParams.perPage}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
