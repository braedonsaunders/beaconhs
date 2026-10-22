import { and, asc, eq, isNull } from 'drizzle-orm'
import {
  equipmentCategories,
  equipmentInspectionTypes,
  customFieldDefinitions,
} from '@beaconhs/db/schema'
import { assertCan } from '@beaconhs/tenant'
import { complianceDate, resolveComplianceClock } from '@beaconhs/compliance'
import type { CustomFieldConfig, CustomFieldType } from '@beaconhs/forms-core'
import { requireRequestContext } from '@/lib/auth'
import { EquipmentSetupDrawer } from './_setup-drawer'
export async function EquipmentSetupLoader({ closeHref }: { closeHref: string }) {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  const data = await ctx.db(async (tx) => {
    const [categories, checklists, defs] = await Promise.all([
      tx
        .select()
        .from(equipmentCategories)
        .orderBy(asc(equipmentCategories.sortOrder), asc(equipmentCategories.name)),
      tx
        .select({
          id: equipmentInspectionTypes.id,
          name: equipmentInspectionTypes.name,
          appliesToTypeId: equipmentInspectionTypes.appliesToTypeId,
          isPreUse: equipmentInspectionTypes.isPreUse,
          intervalValue: equipmentInspectionTypes.intervalValue,
          intervalUnit: equipmentInspectionTypes.intervalUnit,
        })
        .from(equipmentInspectionTypes)
        .where(eq(equipmentInspectionTypes.isActive, true))
        .orderBy(asc(equipmentInspectionTypes.name)),
      tx
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.entityKind, 'equipment'),
            eq(customFieldDefinitions.isActive, true),
            isNull(customFieldDefinitions.deletedAt),
          ),
        )
        .orderBy(asc(customFieldDefinitions.sortOrder), asc(customFieldDefinitions.label)),
    ])
    const today = complianceDate(await resolveComplianceClock(tx, ctx.tenantId))
    return {
      categories: categories.map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        enabledFieldGroups: c.enabledFieldGroups,
      })),
      checklists,
      customFields: defs.map((d) => ({
        key: d.key,
        label: d.label,
        fieldType: d.fieldType as CustomFieldType,
        config: d.config as CustomFieldConfig | null,
        required: d.required,
        subtypeId: d.subtypeId,
        helpText: d.helpText,
      })),
      today,
    }
  })
  return <EquipmentSetupDrawer open closeHref={closeHref} {...data} />
}
