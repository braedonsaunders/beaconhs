import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm'
import { Button, PageHeader } from '@beaconhs/ui'
import {
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
import { performStationScan, searchStation } from './_actions'

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
      ? ((
          await tx
            .select({ name: orgUnits.name })
            .from(orgUnits)
            .where(eq(orgUnits.id, settings.defaultCheckInOrgUnitId))
            .limit(1)
        )[0]?.name ?? null)
      : null

    const peopleRows = await tx
      .select({
        id: people.id,
        userId: people.userId,
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
      tenantName: tenant?.name ?? 'Equipment',
      availableCount: Number(avail?.c ?? 0),
      initialActivePersonId: peopleRows.find((p) => p.userId === ctx.userId)?.id ?? null,
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
        initialActivePersonId={data.initialActivePersonId}
        initialScanCode={initialScanCode}
        onSearch={searchStation}
        onScan={performStationScan}
      />
    </ListPageLayout>
  )
}
