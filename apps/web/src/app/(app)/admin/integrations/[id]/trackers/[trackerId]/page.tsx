import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { GeneratedValue } from '@/i18n/generated'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { and, eq, isNull } from 'drizzle-orm'
import { equipmentTelemetryAssets, syncConnections } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { isUuid } from '@/lib/list-params'
import { PageContainer } from '@/components/page-layout'
import { EquipmentTelemetryPanel } from '@/components/equipment-telemetry-panel'

export async function generateMetadata() {
  const t = await getGeneratedValueTranslations()
  return { title: t('Tracker location history') }
}
export default async function TrackerHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; trackerId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id, trackerId } = await params
  if (!isUuid(id) || !isUuid(trackerId)) notFound()
  const ctx = await requireRequestContext()
  assertCan(ctx, 'admin.integrations.manage')
  const tracker = await ctx.db(async (tx) => {
    const [row] = await tx
      .select({ name: equipmentTelemetryAssets.name })
      .from(equipmentTelemetryAssets)
      .innerJoin(syncConnections, eq(syncConnections.id, equipmentTelemetryAssets.connectionId))
      .where(
        and(
          eq(equipmentTelemetryAssets.id, trackerId),
          eq(equipmentTelemetryAssets.connectionId, id),
          isNull(syncConnections.deletedAt),
        ),
      )
      .limit(1)
    return row
  })
  if (!tracker) notFound()
  return (
    <PageContainer>
      <div className="space-y-4">
        <Link
          href={`/admin/integrations/${id}/trackers`}
          className="text-sm text-teal-700 dark:text-teal-400"
        >
          <GeneratedValue value={'Back to tracker assignments'} />
        </Link>
        <h1 className="text-xl font-semibold">
          {tracker.name} <GeneratedValue value={'· Location history'} />
        </h1>
        <EquipmentTelemetryPanel
          trackerId={trackerId}
          basePath={`/admin/integrations/${id}/trackers/${trackerId}`}
          searchParams={await searchParams}
        />
      </div>
    </PageContainer>
  )
}
