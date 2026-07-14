import { and, eq, isNull, notInArray, or } from 'drizzle-orm'
import { PageHeader } from '@beaconhs/ui'
import { equipmentInspectionTypes, equipmentItems } from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { requireRequestContext } from '@/lib/auth'
import { formatInterval } from '@/lib/equipment/intervals'
import { isUuid } from '@/lib/list-params'
import type { PickerOption } from '@/lib/picker-options'
import { canSeeRecord } from '@/lib/visibility'
import { PageContainer } from '@/components/page-layout'
import { NewInspectionForm } from './_new-form'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Start equipment inspection · BeaconHS' }

export default async function NewEquipmentInspectionPage({
  searchParams,
}: {
  searchParams: Promise<{ typeId?: string; itemId?: string }>
}) {
  const requested = await searchParams
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.inspect')

  // Only hydrate URL-selected values. All candidate lists are searched through
  // bounded, permission-aware pickers instead of loading the whole fleet.
  const initial = await ctx.db(async (tx) => {
    const [item] = isUuid(requested.itemId ?? '')
      ? await tx
          .select({
            id: equipmentItems.id,
            name: equipmentItems.name,
            assetTag: equipmentItems.assetTag,
            typeId: equipmentItems.typeId,
            currentSiteOrgUnitId: equipmentItems.currentSiteOrgUnitId,
            currentHolderPersonId: equipmentItems.currentHolderPersonId,
          })
          .from(equipmentItems)
          .where(
            and(
              eq(equipmentItems.tenantId, ctx.tenantId),
              eq(equipmentItems.id, requested.itemId!),
              eq(equipmentItems.isDraft, false),
              notInArray(equipmentItems.status, ['retired', 'lost']),
              isNull(equipmentItems.deletedAt),
            ),
          )
          .limit(1)
      : []
    const visibleItem =
      item &&
      (await canSeeRecord(ctx, tx, {
        prefix: 'equipment',
        siteId: item.currentSiteOrgUnitId,
        personId: item.currentHolderPersonId,
      }))
        ? item
        : null
    const [type] =
      visibleItem && isUuid(requested.typeId ?? '')
        ? await tx
            .select({
              id: equipmentInspectionTypes.id,
              name: equipmentInspectionTypes.name,
              intervalValue: equipmentInspectionTypes.intervalValue,
              intervalUnit: equipmentInspectionTypes.intervalUnit,
              isPreUse: equipmentInspectionTypes.isPreUse,
            })
            .from(equipmentInspectionTypes)
            .where(
              and(
                eq(equipmentInspectionTypes.tenantId, ctx.tenantId),
                eq(equipmentInspectionTypes.id, requested.typeId!),
                eq(equipmentInspectionTypes.isActive, true),
                or(
                  isNull(equipmentInspectionTypes.appliesToTypeId),
                  visibleItem.typeId
                    ? eq(equipmentInspectionTypes.appliesToTypeId, visibleItem.typeId)
                    : undefined,
                ),
              ),
            )
            .limit(1)
        : []
    return { item: visibleItem, type }
  })

  const initialItem: PickerOption | undefined = initial.item
    ? {
        value: initial.item.id,
        label: `${initial.item.assetTag} · ${initial.item.name}`,
        meta: { kind: 'equipment-inspection-item', typeId: initial.item.typeId },
      }
    : undefined
  const initialType: PickerOption | undefined = initial.type
    ? {
        value: initial.type.id,
        label: initial.type.name,
        hint: formatInterval(initial.type.intervalValue, initial.type.intervalUnit, {
          preUse: initial.type.isPreUse,
        }),
        meta: {
          kind: 'equipment-inspection-type',
          intervalValue: initial.type.intervalValue,
          intervalUnit: initial.type.intervalUnit,
        },
      }
    : undefined

  return (
    <PageContainer>
      <div className="space-y-5">
        <PageHeader
          title="Start an inspection"
          description="Pick the equipment and the inspection type. The checklist loads from the type."
          back={{ href: '/equipment/inspections', label: 'Back to inspections' }}
        />
        <NewInspectionForm initialItem={initialItem} initialType={initialType} />
      </div>
    </PageContainer>
  )
}
