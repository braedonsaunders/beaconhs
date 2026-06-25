import { and, asc, eq, isNull } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { equipmentInspectionTypes, equipmentItems } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { PageContainer } from '@/components/page-layout'
import { NewInspectionForm } from './_new-form'

export const dynamic = 'force-dynamic'

const INTERVAL_LABELS: Record<string, string> = {
  pre_use: 'Pre-use',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annually',
  five_year: 'Every 5 years',
  on_demand: 'On demand',
}

export const metadata = { title: 'Start equipment inspection · BeaconHS' }

export default async function NewEquipmentInspectionPage({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string }>
}) {
  const { typeId } = await searchParams
  const ctx = await requireRequestContext()

  const { items, types } = await ctx.db(async (tx) => {
    const items = await tx
      .select({
        id: equipmentItems.id,
        name: equipmentItems.name,
        assetTag: equipmentItems.assetTag,
      })
      .from(equipmentItems)
      .where(and(isNull(equipmentItems.deletedAt), eq(equipmentItems.isDraft, false)))
      .orderBy(asc(equipmentItems.name))
    const types = await tx
      .select({
        id: equipmentInspectionTypes.id,
        name: equipmentInspectionTypes.name,
        interval: equipmentInspectionTypes.interval,
      })
      .from(equipmentInspectionTypes)
      .where(eq(equipmentInspectionTypes.isActive, true))
      .orderBy(asc(equipmentInspectionTypes.name))
    return { items, types }
  })

  const itemOptions = items.map((i) => ({
    value: i.id,
    label: i.name,
    hint: i.assetTag,
  }))
  const typeOptions = types.map((t) => ({
    value: t.id,
    label: t.name,
    hint: INTERVAL_LABELS[t.interval] ?? t.interval,
  }))

  return (
    <PageContainer>
      <div className="space-y-5">
        <PageHeader
          title="Start an inspection"
          description="Pick the equipment and the inspection type. The checklist loads from the type."
          back={{ href: '/equipment/inspections', label: 'Back to inspections' }}
        />
        <NewInspectionForm
          itemOptions={itemOptions}
          typeOptions={typeOptions}
          defaultTypeId={typeId ?? ''}
        />
      </div>
    </PageContainer>
  )
}
