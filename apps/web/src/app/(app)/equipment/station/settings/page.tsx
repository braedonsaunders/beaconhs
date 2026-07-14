import { and, asc, count, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { equipmentStationSettings, orgUnits, tenants } from '@beaconhs/db/schema'
import { appBaseUrl } from '@/lib/app-base-url'
import { parsePrefixedListParams, pickString } from '@/lib/list-params'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { StationBaseLocationsManager } from './_base-locations'
import { StationSettingsForm } from './_form'

export const metadata = { title: 'Station settings' }
export const dynamic = 'force-dynamic'

export default async function StationSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireModuleManage('equipment')
  const sp = await searchParams
  const baseParams = parsePrefixedListParams(sp, 'base', {
    sort: 'name',
    dir: 'asc',
    perPage: 25,
    allowedSorts: ['name'] as const,
  })
  const baseStateParam = pickString(sp.baseState)
  const baseState =
    baseStateParam === 'base' || baseStateParam === 'other' ? baseStateParam : undefined

  const data = await ctx.db(async (tx) => {
    const [settings] = await tx
      .select()
      .from(equipmentStationSettings)
      .where(eq(equipmentStationSettings.tenantId, ctx.tenantId))
      .limit(1)

    const search = baseParams.q
      ? or(ilike(orgUnits.name, `%${baseParams.q}%`), ilike(orgUnits.code, `%${baseParams.q}%`))
      : undefined
    const baseFilter =
      baseState === 'base'
        ? eq(orgUnits.isEquipmentBase, true)
        : baseState === 'other'
          ? eq(orgUnits.isEquipmentBase, false)
          : undefined
    const baseWhere = and(
      eq(orgUnits.tenantId, ctx.tenantId),
      isNull(orgUnits.deletedAt),
      search,
      baseFilter,
    )
    const [homeRows, tenantRows, totalRows, baseRows] = await Promise.all([
      settings?.defaultCheckInOrgUnitId
        ? tx
            .select({
              id: orgUnits.id,
              name: orgUnits.name,
              code: orgUnits.code,
              level: orgUnits.level,
            })
            .from(orgUnits)
            .where(
              and(
                eq(orgUnits.tenantId, ctx.tenantId),
                eq(orgUnits.id, settings.defaultCheckInOrgUnitId),
                isNull(orgUnits.deletedAt),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      tx.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, ctx.tenantId)).limit(1),
      tx.select({ value: count() }).from(orgUnits).where(baseWhere),
      tx
        .select({
          id: orgUnits.id,
          name: orgUnits.name,
          code: orgUnits.code,
          level: orgUnits.level,
          isBase: orgUnits.isEquipmentBase,
        })
        .from(orgUnits)
        .where(baseWhere)
        .orderBy(desc(orgUnits.isEquipmentBase), asc(orgUnits.name), asc(orgUnits.id))
        .limit(baseParams.perPage)
        .offset((baseParams.page - 1) * baseParams.perPage),
    ])
    return {
      settings: settings ?? null,
      home: homeRows[0] ?? null,
      slug: tenantRows[0]?.slug ?? null,
      baseTotal: totalRows[0]?.value ?? 0,
      baseRows,
    }
  })

  const appUrl = appBaseUrl()
  const stationPinConfigured = Boolean(data.settings?.stationPin)
  const kioskUrl =
    stationPinConfigured && data.slug ? `${appUrl}/equipment-kiosk?t=${data.slug}` : null

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Check-in / out station settings"
            description="Configure the home location, what counts as checked in, scan behaviour, and the mounted-tablet kiosk."
          />
          <EquipmentSubNav active="station-settings" />
        </>
      }
    >
      <div className="space-y-8">
        <StationSettingsForm
          kioskUrl={kioskUrl}
          initialHomeOption={
            data.home
              ? {
                  value: data.home.id,
                  label: data.home.name,
                  hint: [data.home.level, data.home.code].filter(Boolean).join(' · '),
                }
              : undefined
          }
          initial={{
            defaultCheckInOrgUnitId: data.settings?.defaultCheckInOrgUnitId ?? null,
            stationPinConfigured,
            scanMode: data.settings?.scanMode ?? 'toggle',
            requireHolderOnCheckout: data.settings?.requireHolderOnCheckout ?? false,
            requireConditionOnCheckin: data.settings?.requireConditionOnCheckin ?? false,
            soundEnabled: data.settings?.soundEnabled ?? true,
          }}
        />
        <StationBaseLocationsManager
          rows={data.baseRows}
          total={data.baseTotal}
          page={baseParams.page}
          perPage={baseParams.perPage}
          currentParams={sp}
        />
      </div>
    </ListPageLayout>
  )
}
