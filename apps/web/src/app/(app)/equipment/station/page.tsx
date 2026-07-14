import Link from 'next/link'
import { Settings2 } from 'lucide-react'
import { and, count, eq, isNull } from 'drizzle-orm'
import { Button, PageHeader } from '@beaconhs/ui'
import {
  equipmentItems,
  equipmentStationSettings,
  orgUnits,
  people,
  tenants,
} from '@beaconhs/db/schema'
import { primaryPersonTitleName } from '@beaconhs/db'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { canManageModule } from '@/lib/module-admin/guard'
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
  // The settings page is gated by the module-admin permission, not
  // equipment.manage — only show the button to users who can actually open it.
  const canManage = canManageModule(ctx, 'equipment')

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
            .where(
              and(
                eq(orgUnits.tenantId, ctx.tenantId),
                eq(orgUnits.id, settings.defaultCheckInOrgUnitId),
                isNull(orgUnits.deletedAt),
              ),
            )
            .limit(1)
        )[0]?.name ?? null)
      : null

    const [initialPerson] = ctx.personId
      ? await tx
          .select({
            id: people.id,
            firstName: people.firstName,
            lastName: people.lastName,
            employeeNo: people.employeeNo,
            jobTitle: primaryPersonTitleName(people.id, people.tenantId),
          })
          .from(people)
          .where(
            and(
              eq(people.tenantId, ctx.tenantId),
              eq(people.id, ctx.personId),
              eq(people.status, 'active'),
              isNull(people.deletedAt),
            ),
          )
          .limit(1)
      : []

    const [avail] = await tx
      .select({ c: count() })
      .from(equipmentItems)
      .where(
        and(
          eq(equipmentItems.tenantId, ctx.tenantId),
          eq(equipmentItems.isAvailableForCheckout, true),
          isNull(equipmentItems.deletedAt),
        ),
      )

    const [tenant] = await tx
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .limit(1)

    return {
      settings,
      homeName,
      tenantName: tenant?.name ?? 'Equipment',
      availableCount: Number(avail?.c ?? 0),
      initialActivePerson: initialPerson
        ? {
            id: initialPerson.id,
            name: `${initialPerson.lastName}, ${initialPerson.firstName}`,
            employeeNo: initialPerson.employeeNo,
            jobTitle: initialPerson.jobTitle,
          }
        : null,
    }
  })

  return (
    <ListPageLayout
      header={
        <>
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
          <EquipmentSubNav active="station" />
        </>
      }
    >
      <div className="-mx-3 sm:mx-0">
        <StationClient
          surface="app"
          tenantName={data.tenantName}
          scanMode={data.settings?.scanMode ?? 'toggle'}
          soundEnabled={data.settings?.soundEnabled ?? true}
          requireConditionOnCheckin={data.settings?.requireConditionOnCheckin ?? false}
          homeLocationName={data.homeName}
          availableCount={data.availableCount}
          initialActivePerson={data.initialActivePerson}
          initialScanCode={initialScanCode}
          onSearch={searchStation}
          onScan={performStationScan}
        />
      </div>
    </ListPageLayout>
  )
}
