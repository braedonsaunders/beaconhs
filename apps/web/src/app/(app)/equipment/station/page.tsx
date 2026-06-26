import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import { Button, PageHeader } from '@beaconhs/ui'
import {
  equipmentCheckouts,
  equipmentItems,
  equipmentStationSettings,
  orgUnits,
  people,
  tenants,
} from '@beaconhs/db/schema'
import { assertCan, can } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { StationClient } from './_station-client'
import { performStationScan, resolveStationScan } from './_actions'

export const metadata = { title: 'Check in / out station' }
export const dynamic = 'force-dynamic'

export default async function StationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const sp = await searchParams
  const initialScanCode = typeof sp.code === 'string' ? sp.code : null
  const canManage = ctx.isSuperAdmin || can(ctx, 'equipment.manage')

  const data = await ctx.db(async (tx) => {
    const [settings] = await tx
      .select()
      .from(equipmentStationSettings)
      .where(eq(equipmentStationSettings.tenantId, ctx.tenantId))
      .limit(1)

    const homeName = settings?.defaultCheckInOrgUnitId
      ? (
          await tx
            .select({ name: orgUnits.name })
            .from(orgUnits)
            .where(eq(orgUnits.id, settings.defaultCheckInOrgUnitId))
            .limit(1)
        )[0]?.name ?? null
      : null

    const peopleRows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        jobTitle: people.jobTitle,
      })
      .from(people)
      .where(and(eq(people.status, 'active'), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(2000)

    const locationRows = await tx
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

    const openRows = await tx
      .select({
        co: equipmentCheckouts,
        item: equipmentItems,
        holder: people,
        dest: orgUnits,
      })
      .from(equipmentCheckouts)
      .leftJoin(equipmentItems, eq(equipmentItems.id, equipmentCheckouts.equipmentItemId))
      .leftJoin(people, eq(people.id, equipmentCheckouts.holderPersonId))
      .leftJoin(orgUnits, eq(orgUnits.id, equipmentCheckouts.destinationOrgUnitId))
      .where(isNull(equipmentCheckouts.returnedAt))
      .orderBy(desc(equipmentCheckouts.checkedOutAt))
      .limit(200)

    const [avail] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .where(and(eq(equipmentItems.isAvailableForCheckout, true), isNull(equipmentItems.deletedAt)))

    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)

    return {
      settings,
      homeName,
      peopleRows,
      locationRows,
      openRows,
      tenantName: tenant?.name ?? 'Equipment',
      availableCount: Number(avail?.c ?? 0),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <EquipmentSubNav active="station" />
          <PageHeader
            title="Check in / out station"
            description="Scan a badge to set the holder, then scan assets to check them in or out. Works with a USB scanner, phone camera, or by typing a tag."
            actions={
              canManage ? (
                <Link href="/equipment/station/settings">
                  <Button variant="outline">
                    <Settings2 size={14} /> Station settings
                  </Button>
                </Link>
              ) : undefined
            }
          />
        </>
      }
    >
      <StationClient
        surface="app"
        tenantName={data.tenantName}
        scanMode={data.settings?.scanMode ?? 'toggle'}
        soundEnabled={data.settings?.soundEnabled ?? true}
        requireConditionOnCheckin={data.settings?.requireConditionOnCheckin ?? false}
        homeLocationName={data.homeName}
        people={data.peopleRows.map((p) => ({
          id: p.id,
          name: `${p.lastName}, ${p.firstName}`,
          employeeNo: p.employeeNo,
          jobTitle: p.jobTitle,
        }))}
        locations={data.locationRows}
        availableCount={data.availableCount}
        initialScanCode={initialScanCode}
        openCheckouts={data.openRows.map(({ co, item, holder, dest }) => ({
          id: co.id,
          itemId: co.equipmentItemId,
          assetTag: item?.assetTag ?? '—',
          itemName: item?.name ?? 'Unknown',
          holderName: holder ? `${holder.firstName} ${holder.lastName}` : null,
          locationName: dest?.name ?? null,
          checkedOutAt: co.checkedOutAt.toISOString(),
          expectedReturnOn: co.expectedReturnOn,
        }))}
        onResolve={resolveStationScan}
        onScan={performStationScan}
      />
    </ListPageLayout>
  )
}
