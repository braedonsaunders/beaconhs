// The `equipment` record saver: inline edits on an equipment item's page,
// queued on the device and applied by /api/records/sync (see
// lib/record-sync). Same rules the inline editor has always had — the
// `equipment.manage` permission, the shared equipment input validation
// (parseEquipmentAutosaveInput), deleted items are read-only, a department
// must belong to the tenant, every edit commits a draft item, meter readings
// stamp their read-at time — and the same side effects in the same
// transaction: availability refresh on a status change, the `on_create` flow
// when a draft is first committed or `status_change` when the status moves,
// compliance evidence for the item's type, one audit entry per change. Plus a
// compare-and-set against the value the device last saw.
//
// Ops: the equipment_items columns the page edits (core fields, the
// category-driven field groups, the pre-use settings) and `custom:<key>`.

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { isUniqueViolation } from '@beaconhs/db'
import { departments, equipmentItems } from '@beaconhs/db/schema'
import { recordModuleFlowEvent } from '@beaconhs/events'
import { can } from '@beaconhs/tenant'
import { customFieldRecordOp, isCustomFieldOp } from '@/lib/custom-fields/record-op'
import { refreshEquipmentAvailability } from '@/lib/equipment-custody'
import { EQUIPMENT_FIELD_GROUPS, equipmentFieldWireValue } from '@/lib/equipment/field-groups'
import { parseEquipmentAutosaveInput } from '@/lib/equipment/mutation-input'
import { columnOps, flag, optionalRichText, type Codec } from '@/lib/record-sync/codecs'
import {
  RecordEditRejection,
  auditFieldChanges,
  defineRecordSaver,
  recordLocked,
  recordNotFound,
} from '@/lib/record-sync/edits'

type EquipmentRow = typeof equipmentItems.$inferSelect
type LoadedEquipment = {
  row: EquipmentRow
  /** Before this batch: a draft's first edit commits it. */
  wasDraft: boolean
}

const METER_FIELDS = new Set(['currentHours', 'currentOdometer'])

/** Validate with the shared equipment autosave rules. */
function validated(field: string, format: (value: unknown) => string): Codec<unknown> {
  return {
    parse: (wire) => {
      if (wire != null && typeof wire !== 'string') {
        throw new RecordEditRejection('This value is invalid.')
      }
      return parseEquipmentAutosaveInput(field, wire ?? '').value
    },
    format,
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

const EQUIPMENT_CODECS: Record<string, Codec<unknown>> = {
  name: validated('name', text),
  assetTag: validated('assetTag', text),
  serialNumber: validated('serialNumber', text),
  description: validated('description', text),
  status: validated('status', text),
  typeId: validated('typeId', text),
  categoryId: validated('categoryId', text),
  departmentId: validated('departmentId', text),
  preUseInspectionTypeId: validated('preUseInspectionTypeId', text),
  requiresPreUseInspection: flag() as Codec<unknown>,
  // Rich text: sanitized on the way in, like every other rich-text field.
  notes: optionalRichText({ label: 'Notes', maxLength: 100_000 }) as Codec<unknown>,
  ...Object.fromEntries(
    EQUIPMENT_FIELD_GROUPS.flatMap((group) =>
      group.fields.map((field) => [
        field.field,
        validated(field.field, (value) => equipmentFieldWireValue(field, value)),
      ]),
    ),
  ),
}

export const equipmentRecordSaver = defineRecordSaver<LoadedEquipment>('equipment', {
  authorize: (ctx) => can(ctx, 'equipment.manage'),
  async load(tx, ctx, itemId) {
    const [row] = await tx
      .select()
      .from(equipmentItems)
      .where(and(eq(equipmentItems.id, itemId), eq(equipmentItems.tenantId, ctx.tenantId)))
      .limit(1)
      .for('update')
    if (!row) throw recordNotFound()
    if (row.deletedAt) {
      throw recordLocked('This equipment item is deleted. Restore it to edit.')
    }
    return { row, wasDraft: row.isDraft }
  },
  resolve(tx, ctx, { row }, op) {
    if (isCustomFieldOp(op)) {
      return customFieldRecordOp(tx, ctx, { kind: 'equipment', recordId: row.id, record: row, op })
    }
    return columnOps(
      row,
      EQUIPMENT_CODECS as { [K in keyof EquipmentRow]?: Codec<EquipmentRow[K]> },
      async (patch) => {
        if (patch.departmentId) {
          const [department] = await tx
            .select({ id: departments.id })
            .from(departments)
            .where(
              and(eq(departments.id, patch.departmentId), eq(departments.tenantId, ctx.tenantId)),
            )
            .limit(1)
          if (!department) throw new RecordEditRejection('Department was not found.')
        }
        const meterRead = Object.keys(patch).some((field) => METER_FIELDS.has(field))
        try {
          await tx
            .update(equipmentItems)
            .set({
              ...patch,
              // Editing the asset commits a draft (clears the Draft badge).
              isDraft: false,
              // Meter readings carry a read-at timestamp so staleness is visible.
              ...(meterRead ? { metersUpdatedAt: new Date() } : {}),
            })
            .where(and(eq(equipmentItems.id, row.id), eq(equipmentItems.tenantId, ctx.tenantId)))
        } catch (error) {
          if (isUniqueViolation(error, 'equipment_items_tenant_tag_ux')) {
            throw new RecordEditRejection('Another equipment item already uses this asset tag.')
          }
          throw error
        }
        row.isDraft = false
      },
    )(op)
  },
  async afterWrites(tx, ctx, { row, wasDraft }, changes) {
    // Custom-field values audit themselves and never commit a draft.
    const native = changes.filter((change) => !isCustomFieldOp(change.op))
    if (native.length === 0) return
    const statusChange = native.find((change) => change.op === 'status')
    if (statusChange) await refreshEquipmentAvailability(tx, [row.id])
    if (wasDraft) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: row.id,
        moduleKey: 'equipment-assets',
        event: 'on_create',
        occurrenceKey: randomUUID(),
      })
    } else if (statusChange) {
      await recordModuleFlowEvent(tx, ctx, {
        subjectId: row.id,
        moduleKey: 'equipment-assets',
        event: 'status_change',
        toStatus: String(statusChange.after),
        occurrenceKey: randomUUID(),
      })
    }
    await auditFieldChanges(tx, ctx, { entityType: 'equipment', entityId: row.id }, native)
  },
  revalidate: (itemId) => [`/equipment/${itemId}`, '/equipment'],
})
