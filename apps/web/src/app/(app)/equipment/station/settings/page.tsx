import { asc, desc, eq, isNull } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { equipmentStationSettings, orgUnits, tenants } from '@beaconhs/db/schema'
import { appBaseUrl } from '@/lib/app-base-url'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { StationSettingsForm } from './_form'

export const metadata = { title: 'Station settings' }
export const dynamic = 'force-dynamic'

export default async function StationSettingsPage() {
  const ctx = await requireModuleManage('equipment')

  const { settings, locations, baseIds, slug } = await ctx.db(async (tx) => {
    const [s] = await tx
      .select()
      .from(equipmentStationSettings)
      .where(eq(equipmentStationSettings.tenantId, ctx.tenantId))
      .limit(1)
    const locs = await tx
      .select({
        id: orgUnits.id,
        name: orgUnits.name,
        level: orgUnits.level,
        isBase: orgUnits.isEquipmentBase,
      })
      .from(orgUnits)
      .where(isNull(orgUnits.deletedAt))
      .orderBy(desc(orgUnits.isEquipmentBase), asc(orgUnits.name))
      .limit(2000)
    const [t] = await tx
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)
    return {
      settings: s ?? null,
      locations: locs.map((l) => ({ id: l.id, name: l.name, level: l.level })),
      baseIds: locs.filter((l) => l.isBase).map((l) => l.id),
      slug: t?.slug ?? null,
    }
  })

  const appUrl = appBaseUrl()
  const stationPinConfigured = Boolean(settings?.stationPin)
  const kioskUrl = stationPinConfigured && slug ? `${appUrl}/equipment-kiosk?t=${slug}` : null

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
      <StationSettingsForm
        locations={locations}
        kioskUrl={kioskUrl}
        initial={{
          defaultCheckInOrgUnitId: settings?.defaultCheckInOrgUnitId ?? null,
          stationPinConfigured,
          scanMode: settings?.scanMode ?? 'toggle',
          requireHolderOnCheckout: settings?.requireHolderOnCheckout ?? false,
          requireConditionOnCheckin: settings?.requireConditionOnCheckin ?? false,
          soundEnabled: settings?.soundEnabled ?? true,
          baseLocationIds: baseIds,
        }}
      />
    </ListPageLayout>
  )
}
