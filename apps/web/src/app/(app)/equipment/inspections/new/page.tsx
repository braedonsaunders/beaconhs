import { and, asc, eq, isNull } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { equipmentInspectionTypes, equipmentItems } from '@beaconhs/db/schema'
import { requireRequestContext } from '@/lib/auth'
import { formatInterval } from '@/lib/equipment/intervals'
import { PageContainer } from '@/components/page-layout'
import { NewInspectionForm } from './_new-form'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Start equipment inspection · BeaconHS' }

export default async function NewEquipmentInspectionPage({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string; itemId?: string }>
}) {
  const { typeId, itemId } = await searchParams
  const ctx = await requireRequestContext()

  const { items, types } = await ctx.db(async (tx) => {
    const items = await tx
      .select({
        id: equipmentItems.id,
        name: equipmentItems.name,
        assetTag: equipmentItems.assetTag,
        typeId: equipmentItems.typeId,
      })
      .from(equipmentItems)
      .where(and(isNull(equipmentItems.deletedAt), eq(equipmentItems.isDraft, false)))
      .orderBy(asc(equipmentItems.name))
    const types = await tx
      .select({
        id: equipmentInspectionTypes.id,
        name: equipmentInspectionTypes.name,
        intervalValue: equipmentInspectionTypes.intervalValue,
        intervalUnit: equipmentInspectionTypes.intervalUnit,
        isPreUse: equipmentInspectionTypes.isPreUse,
        appliesToTypeId: equipmentInspectionTypes.appliesToTypeId,
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
    typeId: i.typeId,
  }))
  const typeOptions = types.map((t) => ({
    value: t.id,
    label: t.name,
    hint: formatInterval(t.intervalValue, t.intervalUnit, { preUse: t.isPreUse }),
    appliesToTypeId: t.appliesToTypeId,
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
          defaultItemId={itemId ?? ''}
          defaultTypeId={typeId ?? ''}
        />
      </div>
    </PageContainer>
  )
}
