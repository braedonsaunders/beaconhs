import { getGeneratedTranslations } from '@/i18n/generated.server'
import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { people, vehicleLogSettings } from '@beaconhs/db/schema'
import { requireModuleManage } from '@/lib/module-admin/guard'
import { ListPageLayout } from '@/components/page-layout'
import { EquipmentSubNav } from '@/components/equipment-sub-nav'
import { driverVehicleLogMode } from '../_service'
import { VehicleLogSettingsForm } from './_form.client'
import { parseListParams, pickString } from '@/lib/list-params'

export async function generateMetadata() {
  const tGenerated = await getGeneratedTranslations()
  return { title: tGenerated('m_0fab21e2e4bd27') }
}
export const dynamic = 'force-dynamic'

const OVERRIDE_SORTS = ['name', 'mode'] as const

export default async function VehicleLogSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const tGenerated = await getGeneratedTranslations()
  const sp = await searchParams
  const params = parseListParams(sp, {
    sort: 'name',
    dir: 'asc',
    perPage: 20,
    allowedSorts: OVERRIDE_SORTS,
  })
  const requestedMode = pickString(sp.overrideMode)
  const overrideMode =
    requestedMode === 'destination' || requestedMode === 'odometer' ? requestedMode : undefined
  const ctx = await requireModuleManage('vehicle-log')

  const { settings, overrides, total, filteredTotal } = await ctx.db(async (tx) => {
    const [s] = await tx
      .select({
        enabledModes: vehicleLogSettings.enabledModes,
        defaultMode: vehicleLogSettings.defaultMode,
      })
      .from(vehicleLogSettings)
      .where(eq(vehicleLogSettings.tenantId, ctx.tenantId))
      .limit(1)
    const modeExpression = sql<string>`${people.metadata}->>'vehicleLogMode'`
    const baseWhere = and(
      eq(people.status, 'active'),
      sql`${modeExpression} in ('destination', 'odometer')`,
    )
    const filteredWhere = and(
      baseWhere,
      params.q
        ? or(
            ilike(people.firstName, `%${params.q}%`),
            ilike(people.lastName, `%${params.q}%`),
            ilike(people.employeeNo, `%${params.q}%`),
          )
        : undefined,
      overrideMode ? eq(modeExpression, overrideMode) : undefined,
    )
    const [totalRows, filteredRows, rows] = await Promise.all([
      tx.select({ count: count() }).from(people).where(baseWhere),
      tx.select({ count: count() }).from(people).where(filteredWhere),
      tx
        .select({
          id: people.id,
          firstName: people.firstName,
          lastName: people.lastName,
          employeeNo: people.employeeNo,
          metadata: people.metadata,
        })
        .from(people)
        .where(filteredWhere)
        .orderBy(
          ...(params.sort === 'mode' ? [asc(modeExpression)] : []),
          asc(people.lastName),
          asc(people.firstName),
          asc(people.id),
        )
        .limit(params.perPage)
        .offset((params.page - 1) * params.perPage),
    ])
    return {
      settings: s ?? null,
      overrides: rows,
      total: Number(totalRows[0]?.count ?? 0),
      filteredTotal: Number(filteredRows[0]?.count ?? 0),
    }
  })

  return (
    <ListPageLayout
      header={
        <>
          <PageHeader
            title={tGenerated('m_0fab21e2e4bd27')}
            description={tGenerated('m_030f391e467fd4')}
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
        overrides={overrides.map((person) => ({
          id: person.id,
          label: `${person.lastName}, ${person.firstName}`,
          hint: person.employeeNo ?? undefined,
          mode: driverVehicleLogMode(person.metadata),
        }))}
        total={total}
        filteredTotal={filteredTotal}
        page={params.page}
        perPage={params.perPage}
        currentParams={sp}
      />
    </ListPageLayout>
  )
}
