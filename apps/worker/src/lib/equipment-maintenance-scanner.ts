// Equipment maintenance detection — runs inside the unified compliance scan's
// per-tenant heartbeat (same tenant-configured cadence, no separate tick).
// Finds inspection schedules and ad-hoc reminders whose due date has arrived
// and that haven't been alerted for this due cycle, and atomically records a
// durable dispatch snapshot. The publisher queues a retry-safe batch and only
// then stamps the exact due cycle. Completing the work advances the due date,
// which re-arms the stamp for the next cycle.

import { and, asc, eq, isNull, lte, notInArray, sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import {
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentMaintenanceDispatches,
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

  const entries = await withTenant(db, tenantId, async (tx) => {
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
    if (entries.length === 0) return entries
    const scheduleCycles = dueSchedules.map((schedule) => ({
      id: schedule.id,
      dueOn: schedule.dueOn,
    }))
    const reminderCycles = dueReminders.map((reminder) => ({
      id: reminder.id,
      dueOn: reminder.dueOn,
    }))
    const deliveryKey = [
      ...scheduleCycles.map((cycle) => `s:${cycle.id}@${cycle.dueOn}`),
      ...reminderCycles.map((cycle) => `r:${cycle.id}@${cycle.dueOn}`),
    ]
      .sort()
      .join('|')
    await tx
      .insert(equipmentMaintenanceDispatches)
      .values({
        tenantId,
        deliveryKey,
        entries,
        scheduleCycles,
        reminderCycles,
      })
      .onConflictDoNothing({
        target: [
          equipmentMaintenanceDispatches.tenantId,
          equipmentMaintenanceDispatches.deliveryKey,
        ],
      })
    return entries
  })

  return entries.length
}

/** Publish durable due-cycle snapshots and stamp only the exact cycles sent. */
export async function publishQueuedEquipmentMaintenance(): Promise<{
  published: number
  errors: number
}> {
  const result = { published: 0, errors: 0 }
  const queued = await withSuperAdmin(db, (tx) =>
    tx
      .select()
      .from(equipmentMaintenanceDispatches)
      .where(eq(equipmentMaintenanceDispatches.status, 'queued'))
      .orderBy(asc(equipmentMaintenanceDispatches.createdAt))
      .limit(500),
  )
  for (const dispatch of queued) {
    if (dispatch.entries.length === 0) {
      result.errors += 1
      await withSuperAdmin(db, (tx) =>
        tx
          .update(equipmentMaintenanceDispatches)
          .set({ status: 'failed', error: 'Equipment maintenance dispatch has no entries' })
          .where(eq(equipmentMaintenanceDispatches.id, dispatch.id)),
      )
      continue
    }
    try {
      await emitEquipmentMaintenanceDue(dispatch.tenantId, dispatch.entries, dispatch.deliveryKey)
      await withTenant(db, dispatch.tenantId, async (tx) => {
        for (const cycle of dispatch.scheduleCycles) {
          await tx
            .update(equipmentInspectionSchedules)
            .set({ dueNotifiedFor: cycle.dueOn })
            .where(
              and(
                eq(equipmentInspectionSchedules.id, cycle.id),
                eq(equipmentInspectionSchedules.nextDueOn, cycle.dueOn),
              ),
            )
        }
        for (const cycle of dispatch.reminderCycles) {
          await tx
            .update(equipmentReminders)
            .set({ dueNotifiedFor: cycle.dueOn })
            .where(
              and(
                eq(equipmentReminders.id, cycle.id),
                eq(equipmentReminders.dueOn, cycle.dueOn),
                isNull(equipmentReminders.completedAt),
              ),
            )
        }
        await tx
          .update(equipmentMaintenanceDispatches)
          .set({ status: 'enqueued', error: null })
          .where(
            and(
              eq(equipmentMaintenanceDispatches.id, dispatch.id),
              eq(equipmentMaintenanceDispatches.status, 'queued'),
            ),
          )
      })
      result.published += 1
    } catch (error) {
      result.errors += 1
      await withSuperAdmin(db, (tx) =>
        tx
          .update(equipmentMaintenanceDispatches)
          .set({ error: error instanceof Error ? error.message : String(error) })
          .where(eq(equipmentMaintenanceDispatches.id, dispatch.id)),
      )
    }
  }
  return result
}
