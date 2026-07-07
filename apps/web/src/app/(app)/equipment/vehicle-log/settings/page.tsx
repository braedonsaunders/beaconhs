import { asc, eq } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { people, vehicleLogSettings } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { driverVehicleLogMode } from '../_service'
import { VehicleLogSettingsForm } from './_form.client'

export const metadata = { title: 'Vehicle log settings' }
export const dynamic = 'force-dynamic'

export default async function VehicleLogSettingsPage() {
  const ctx = await requireModuleManage('vehicle-log')

  const { settings, drivers } = await ctx.db(async (tx) => {
    const [s] = await tx
      .select({
        enabledModes: vehicleLogSettings.enabledModes,
        defaultMode: vehicleLogSettings.defaultMode,
      })
      .from(vehicleLogSettings)
      .where(eq(vehicleLogSettings.tenantId, ctx.tenantId))
      .limit(1)
    const rows = await tx
      .select({
        id: people.id,
        firstName: people.firstName,
        lastName: people.lastName,
        employeeNo: people.employeeNo,
        metadata: people.metadata,
      })
      .from(people)
      .where(eq(people.status, 'active'))
      .orderBy(asc(people.lastName), asc(people.firstName))
      .limit(2000)
    return { settings: s ?? null, drivers: rows }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title="Vehicle log settings"
            description="Which entry modes drivers use and where each driver lands by default."
          />
          <EquipmentSubNav active="vehicle-log-settings" />
        </>
      }
    >
      <VehicleLogSettingsForm
        initial={{
          enabledModes: settings?.enabledModes ?? 'both',
          defaultMode: settings?.defaultMode ?? 'destination',
        }}
        people={drivers.map((p) => ({
          id: p.id,
          label: `${p.lastName}, ${p.firstName}`,
          hint: p.employeeNo ?? undefined,
          mode: driverVehicleLogMode(p.metadata),
        }))}
      />
    </ListPageLayout>
  )
}
