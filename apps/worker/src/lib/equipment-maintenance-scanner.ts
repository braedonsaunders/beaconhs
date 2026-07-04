// Equipment maintenance detection — runs inside the unified compliance scan's
// per-tenant heartbeat (same tenant-configured cadence, no separate tick).
// Finds inspection schedules and ad-hoc reminders whose due date has arrived
// and that haven't been alerted for this due cycle, emits one batch through
// the events dispatcher (assignee self-targets + audience rollup), then stamps
// due_notified_for so a still-overdue item never re-alerts. Completing the
// work advances the due date, which re-arms the stamp for the next cycle.

import { and, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm'
import { db, withTenant } from '@beaconhs/db'
import {
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentReminders,
} from '@beaconhs/db/schema'
import { emitEquipmentMaintenanceDue, type EquipmentMaintenanceDueEntry } from '@beaconhs/events'

/** Scan one tenant; returns how many entries were alerted. */
export async function scanTenantEquipmentMaintenance(tenantId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)

  // Items that are gone from service don't page anyone.
  const itemFilters = [
    isNull(equipmentItems.deletedAt),
    notInArray(equipmentItems.status, ['retired', 'lost']),
  ]

  const { entries, scheduleIds, reminderIds } = await withTenant(db, tenantId, async (tx) => {
    const dueSchedules = await tx
      .select({
        id: equipmentInspectionSchedules.id,
        dueOn: equipmentInspectionSchedules.nextDueOn,
        label: equipmentInspectionSchedules.label,
        typeName: equipmentInspectionTypes.name,
        equipmentItemId: equipmentItems.id,
        itemName: equipmentItems.name,
        assetTag: equipmentItems.assetTag,
      })
      .from(equipmentInspectionSchedules)
      .innerJoin(
        equipmentItems,
        eq(equipmentItems.id, equipmentInspectionSchedules.equipmentItemId),
      )
      .leftJoin(
        equipmentInspectionTypes,
        eq(equipmentInspectionTypes.id, equipmentInspectionSchedules.inspectionTypeId),
      )
      .where(
        and(
          eq(equipmentInspectionSchedules.isActive, true),
          lte(equipmentInspectionSchedules.nextDueOn, today),
          sql`${equipmentInspectionSchedules.dueNotifiedFor} IS DISTINCT FROM ${equipmentInspectionSchedules.nextDueOn}`,
          ...itemFilters,
        ),
      )

    const dueReminders = await tx
      .select({
        id: equipmentReminders.id,
        dueOn: equipmentReminders.dueOn,
        title: equipmentReminders.title,
        assigneePersonId: equipmentReminders.assignedToPersonId,
        equipmentItemId: equipmentItems.id,
        itemName: equipmentItems.name,
        assetTag: equipmentItems.assetTag,
      })
      .from(equipmentReminders)
      .innerJoin(equipmentItems, eq(equipmentItems.id, equipmentReminders.equipmentItemId))
      .where(
        and(
          isNull(equipmentReminders.completedAt),
          lte(equipmentReminders.dueOn, today),
          sql`${equipmentReminders.dueNotifiedFor} IS DISTINCT FROM ${equipmentReminders.dueOn}`,
          ...itemFilters,
        ),
      )

    const entries: EquipmentMaintenanceDueEntry[] = [
      ...dueSchedules.map((s) => ({
        kind: 'inspection' as const,
        equipmentItemId: s.equipmentItemId,
        itemName: s.itemName,
        assetTag: s.assetTag,
        title: s.typeName ?? s.label ?? 'Inspection',
        dueOn: s.dueOn,
      })),
      ...dueReminders.map((r) => ({
        kind: 'reminder' as const,
        equipmentItemId: r.equipmentItemId,
        itemName: r.itemName,
        assetTag: r.assetTag,
        title: r.title,
        dueOn: r.dueOn,
        assigneePersonId: r.assigneePersonId,
      })),
    ]
    return {
      entries,
      scheduleIds: dueSchedules.map((s) => s.id),
      reminderIds: dueReminders.map((r) => r.id),
    }
  })

  if (entries.length === 0) return 0

  // emit* never throws — a notification failure must not stop the stamps below
  // from being written (the next scan would double-alert otherwise is the
  // wrong trade; we prefer at-most-once per cycle).
  await emitEquipmentMaintenanceDue(tenantId, entries)

  await withTenant(db, tenantId, async (tx) => {
    if (scheduleIds.length > 0) {
      await tx
        .update(equipmentInspectionSchedules)
        .set({ dueNotifiedFor: sql`${equipmentInspectionSchedules.nextDueOn}` })
        .where(inArray(equipmentInspectionSchedules.id, scheduleIds))
    }
    if (reminderIds.length > 0) {
      await tx
        .update(equipmentReminders)
        .set({ dueNotifiedFor: sql`${equipmentReminders.dueOn}` })
        .where(inArray(equipmentReminders.id, reminderIds))
    }
  })

  return entries.length
}
