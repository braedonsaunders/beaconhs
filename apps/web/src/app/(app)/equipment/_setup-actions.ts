'use server'
import { randomBytes } from 'node:crypto'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { pgError } from '@beaconhs/db'
import {
  equipmentCategories,
  equipmentTypes,
  equipmentItems,
  equipmentInspectionTypes,
  equipmentInspectionSchedules,
  customFieldDefinitions,
} from '@beaconhs/db/schema'
import {
  coerceCustomFieldValue,
  type CustomFieldConfig,
  type CustomFieldType,
} from '@beaconhs/forms-core'
import { assertCan } from '@beaconhs/tenant'
import { revalidatePath } from 'next/cache'
import { requireRequestContext } from '@/lib/auth'
import { recordAuditInTransaction } from '@/lib/audit'
import { requiredTextInput, requireUuidInput, requiredDateInput } from '@/lib/mutation-input'
import { parseEquipmentAutosaveInput } from '@/lib/equipment/mutation-input'
import { EQUIPMENT_FIELD_GROUPS } from '@/lib/equipment/field-groups'
import {
  equipmentSetupStepError,
  equipmentSetupSectionsError,
  type EquipmentSetupInput,
} from '@/lib/equipment/setup'
import {
  persistServicePlan,
  parseServicePlan,
  persistServiceMeters,
} from '@/lib/equipment/service-plans'
export async function createEquipmentFromSetup(
  input: EquipmentSetupInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const ctx = await requireRequestContext()
  assertCan(ctx, 'equipment.manage')
  try {
    const id = requireUuidInput(input.requestId, 'Creation request')
    const categoryId = requireUuidInput(input.categoryId, 'Category')
    for (let step = 0; step < 5; step++) {
      const error = equipmentSetupStepError(input, step)
      if (error) throw new Error(error)
    }
    if (input.inspectionSchedules.length > 20 || input.maintenance.length > 30)
      throw new Error(
        'Add no more than twenty inspections and thirty maintenance tasks during setup.',
      )
    const name = requiredTextInput(input.name, 'Name', 240)
    const assetTag = requiredTextInput(input.assetTag, 'Asset tag', 120)
    const created = await ctx.db(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':equipment-setup:' + id},0))`,
      )
      const [existing] = await tx
        .select({ id: equipmentItems.id, metadata: equipmentItems.metadata })
        .from(equipmentItems)
        .where(eq(equipmentItems.id, id))
        .limit(1)
      if (existing) {
        if (existing.metadata.setupRequestId !== id)
          throw new Error('This creation request belongs to another record. Start a new setup.')
        return existing.id
      }
      const [category] = await tx
        .select()
        .from(equipmentCategories)
        .where(eq(equipmentCategories.id, categoryId))
        .limit(1)
      const sectionError = equipmentSetupSectionsError(input, category?.enabledFieldGroups)
      if (category && sectionError) throw new Error(sectionError)
      if (!category)
        throw new Error(
          'Choose an existing equipment category. Ask a manager to add one if necessary.',
        )
      let typeId = input.typeId ? requireUuidInput(input.typeId, 'Equipment type') : null
      if (typeId) {
        const [type] = await tx
          .select({ id: equipmentTypes.id })
          .from(equipmentTypes)
          .where(eq(equipmentTypes.id, typeId))
          .limit(1)
        if (!type) throw new Error('Choose an existing equipment type.')
      } else {
        const typeName = requiredTextInput(input.newTypeName, 'New equipment type', 240)
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${ctx.tenantId + ':equipment-type:' + typeName.toLowerCase()},0))`,
        )
        const [type] = await tx
          .select({ id: equipmentTypes.id })
          .from(equipmentTypes)
          .where(
            and(
              sql`lower(${equipmentTypes.name})=lower(${typeName})`,
              eq(equipmentTypes.categoryId, categoryId),
            ),
          )
          .limit(1)
        if (type) typeId = type.id
        else {
          const [createdType] = await tx
            .insert(equipmentTypes)
            .values({ tenantId: ctx.tenantId, name: typeName, categoryId })
            .returning({ id: equipmentTypes.id })
          if (!createdType) throw new Error('Could not create equipment type.')
          typeId = createdType.id
          await recordAuditInTransaction(tx, ctx, {
            entityType: 'equipment_type',
            entityId: typeId,
            action: 'create',
            summary: `Added equipment type: ${typeName}`,
          })
        }
      }
      const allowed = new Set([
        'serialNumber',
        ...EQUIPMENT_FIELD_GROUPS.flatMap((g) => g.fields.map((f) => f.field)),
      ])
      const fields: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(input.fields)) {
        if (!allowed.has(key)) throw new Error('Unknown equipment detail.')
        const parsed = parseEquipmentAutosaveInput(key, value)
        fields[key] = parsed.value
      }
      const defs = await tx
        .select()
        .from(customFieldDefinitions)
        .where(
          and(
            eq(customFieldDefinitions.entityKind, 'equipment'),
            eq(customFieldDefinitions.isActive, true),
            isNull(customFieldDefinitions.deletedAt),
            or(
              isNull(customFieldDefinitions.subtypeId),
              eq(customFieldDefinitions.subtypeId, typeId!),
            ),
          ),
        )
        .for('share')
      const custom: Record<string, unknown> = {}
      for (const def of defs) {
        const result = coerceCustomFieldValue(
          {
            key: def.key,
            label: def.label,
            required: def.required,
            fieldType: def.fieldType as CustomFieldType,
            config: def.config as CustomFieldConfig | null,
          },
          input.custom[def.key] ?? '',
        )
        if (!result.ok) throw new Error(result.error)
        if (result.value !== null) custom[def.key] = result.value
      }
      const typeFor = async (raw: string, preUse: boolean) => {
        const type = requireUuidInput(raw, 'Inspection checklist')
        const [row] = await tx
          .select()
          .from(equipmentInspectionTypes)
          .where(
            and(
              eq(equipmentInspectionTypes.id, type),
              eq(equipmentInspectionTypes.isActive, true),
              eq(equipmentInspectionTypes.isPreUse, preUse),
              or(
                isNull(equipmentInspectionTypes.appliesToTypeId),
                eq(equipmentInspectionTypes.appliesToTypeId, typeId!),
              ),
            ),
          )
          .limit(1)
        if (!row)
          throw new Error(
            'Choose an active inspection checklist that applies to this equipment type.',
          )
        return type
      }
      const preUseTypeId = input.preUseRequired ? await typeFor(input.preUseTypeId, true) : null
      const [item] = await tx
        .insert(equipmentItems)
        .values({
          ...fields,
          id,
          tenantId: ctx.tenantId,
          name,
          assetTag,
          categoryId,
          typeId,
          qrToken: randomBytes(18).toString('base64url'),
          isDraft: false,
          requiresPreUseInspection: input.preUseRequired === true,
          preUseInspectionTypeId: preUseTypeId,
          metadata: {
            custom,
            setupRequestId: id,
            setup: {
              sections: Object.fromEntries(
                EQUIPMENT_FIELD_GROUPS.flatMap((group) => {
                  const section = input.sections?.[group.key]
                  return section?.unavailable === true
                    ? [
                        [
                          group.key,
                          {
                            unavailable: true,
                            reason: requiredTextInput(section.reason, 'Reason', 2000),
                          },
                        ],
                      ]
                    : []
                }),
              ),
              inspectionsReviewed: true,
              maintenanceReviewed: true,
              noInspectionsReason:
                !input.preUseRequired && !input.scheduledInspectionsRequired
                  ? requiredTextInput(input.noInspectionsReason, 'Reason', 2000)
                  : null,
              noMaintenanceReason: !input.maintenanceRequired
                ? requiredTextInput(input.noMaintenanceReason, 'Reason', 2000)
                : null,
              identifyingDetailsReason: input.identifyingDetailsUnavailable
                ? requiredTextInput(input.identifyingDetailsReason, 'Reason', 2000)
                : null,
            },
          },
        })
        .returning({ id: equipmentItems.id })
      if (!item) throw new Error('Could not create equipment.')
      if (input.scheduledInspectionsRequired)
        for (const schedule of input.inspectionSchedules) {
          if (
            !Number.isInteger(schedule.every) ||
            schedule.every < 1 ||
            schedule.every > 1200 ||
            !['day', 'week', 'month', 'year'].includes(schedule.unit)
          )
            throw new Error('Enter a valid inspection interval.')
          const inspectionTypeId = await typeFor(schedule.typeId, false)
          await tx.insert(equipmentInspectionSchedules).values({
            tenantId: ctx.tenantId,
            equipmentItemId: id,
            inspectionTypeId,
            intervalValue: schedule.every,
            intervalUnit: schedule.unit,
            nextDueOn: requiredDateInput(schedule.dueOn, 'First inspection due'),
            createdByTenantUserId: ctx.membership?.id ?? null,
          })
        }
      if (input.maintenanceRequired)
        for (const plan of input.maintenance)
          await persistServiceMeters(tx, ctx, id, parseServicePlan(plan).meters)
      if (input.maintenanceRequired)
        for (const plan of input.maintenance) {
          if (plan.id) throw new Error('New equipment requires new maintenance tasks.')
          await persistServicePlan(tx, ctx, id, plan)
        }
      await recordAuditInTransaction(tx, ctx, {
        entityType: 'equipment',
        entityId: id,
        action: 'create',
        summary: `Created equipment through guided setup: ${name}`,
        after: {
          assetTag,
          categoryId,
          typeId,
          preUseTypeId,
          scheduledInspections: input.scheduledInspectionsRequired
            ? input.inspectionSchedules.length
            : 0,
          maintenancePlans: input.maintenanceRequired ? input.maintenance.length : 0,
        },
      })
      return id
    })
    revalidatePath('/equipment')
    revalidatePath('/equipment/maintenance')
    return { ok: true, id: created }
  } catch (error) {
    const pg = pgError(error)
    if (pg)
      return {
        ok: false,
        error:
          pg.code === '23505'
            ? 'This asset tag is already in use. Choose a different tag.'
            : 'Equipment could not be saved. Check the selected details and try again.',
      }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Could not create equipment.',
    }
  }
}
