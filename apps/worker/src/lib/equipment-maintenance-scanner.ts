// Equipment maintenance detection — runs inside the unified compliance scan's
// per-tenant heartbeat (same tenant-configured cadence, no separate tick).
// Finds inspection schedules and ad-hoc reminders whose due date has arrived
// and that haven't been alerted for this due cycle, and atomically records a
// durable dispatch snapshot. The publisher queues a retry-safe batch and only
// then stamps the exact due cycle. Completing the work advances the due date,
// which re-arms the stamp for the next cycle.

import { and, asc, eq, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant, type Database } from '@beaconhs/db'
import {
  equipmentInspectionSchedules,
  equipmentInspectionTypes,
  equipmentItems,
  equipmentMaintenanceDispatches,
  equipmentReminders,
} from '@beaconhs/db/schema'
import { emitEquipmentMaintenanceDue, type EquipmentMaintenanceDueEntry } from '@beaconhs/events'
import {
  chunkEquipmentMaintenance,
  equipmentMaintenanceDeliveryKey,
  EQUIPMENT_MAINTENANCE_SOURCE_LIMIT,
  type EquipmentMaintenanceCycleIdentity,
} from './equipment-maintenance-dispatch-policy'
import {
  durablePublicationClaimPredicate,
  durablePublicationError,
  durablePublicationRetryAt,
  DURABLE_PUBLICATION_BATCH_SIZE,
} from './durable-publication-policy'

/** Scan one tenant; returns how many entries were alerted. */
export async function scanTenantEquipmentMaintenance(tenantId: string): Promise<number> {
  const today = new Date().toISOString().slice(0, 10)

  // Items that are gone from service don't page anyone.
  const itemFilters = [
    isNull(equipmentItems.deletedAt),
    notInArray(equipmentItems.status, ['retired', 'lost']),
  ]

  const queuedCount = await withTenant(db, tenantId, async (tx) => {
    // Serialize the snapshot transaction per tenant. Without this lock, two
    // delayed/retried scans can create overlapping snapshots when a new due
    // record appears between their reads.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`equipment-maintenance:${tenantId}`}, 0))`,
    )
    const [outstanding] = await tx
      .select({ id: equipmentMaintenanceDispatches.id })
      .from(equipmentMaintenanceDispatches)
      .where(
        and(
          eq(equipmentMaintenanceDispatches.tenantId, tenantId),
          eq(equipmentMaintenanceDispatches.status, 'queued'),
        ),
      )
      .limit(1)
    // The queued snapshot already owns every unstamped cycle that existed at
    // its scan time. Let its retry finish before snapshotting newly due work.
    if (outstanding) return 0

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
      .orderBy(asc(equipmentInspectionSchedules.id))
      .limit(EQUIPMENT_MAINTENANCE_SOURCE_LIMIT)

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
      .orderBy(asc(equipmentReminders.id))
      .limit(EQUIPMENT_MAINTENANCE_SOURCE_LIMIT)

    const candidates: Array<{
      entry: EquipmentMaintenanceDueEntry
      cycle: EquipmentMaintenanceCycleIdentity
    }> = [
      ...dueSchedules.map((schedule) => ({
        entry: {
          kind: 'inspection' as const,
          equipmentItemId: schedule.equipmentItemId,
          itemName: schedule.itemName,
          assetTag: schedule.assetTag,
          title: schedule.typeName ?? schedule.label ?? 'Inspection',
          dueOn: schedule.dueOn,
        },
        cycle: {
          kind: 'inspection' as const,
          id: schedule.id,
          dueOn: schedule.dueOn,
        },
      })),
      ...dueReminders.map((reminder) => ({
        entry: {
          kind: 'reminder' as const,
          equipmentItemId: reminder.equipmentItemId,
          itemName: reminder.itemName,
          assetTag: reminder.assetTag,
          title: reminder.title,
          dueOn: reminder.dueOn,
          assigneePersonId: reminder.assigneePersonId,
        },
        cycle: {
          kind: 'reminder' as const,
          id: reminder.id,
          dueOn: reminder.dueOn,
        },
      })),
    ]
    if (candidates.length === 0) return 0
    const dispatches = chunkEquipmentMaintenance(candidates).map((batch) => ({
      tenantId,
      deliveryKey: equipmentMaintenanceDeliveryKey(
        tenantId,
        batch.map(({ cycle }) => cycle),
      ),
      entries: batch.map(({ entry }) => entry),
      scheduleCycles: batch
        .filter(({ cycle }) => cycle.kind === 'inspection')
        .map(({ cycle }) => ({ id: cycle.id, dueOn: cycle.dueOn })),
      reminderCycles: batch
        .filter(({ cycle }) => cycle.kind === 'reminder')
        .map(({ cycle }) => ({ id: cycle.id, dueOn: cycle.dueOn })),
    }))
    await tx
      .insert(equipmentMaintenanceDispatches)
      .values(dispatches)
      .onConflictDoNothing({
        target: [
          equipmentMaintenanceDispatches.tenantId,
          equipmentMaintenanceDispatches.deliveryKey,
        ],
      })
    return candidates.length
  })

  return queuedCount
}

async function claimQueuedEquipmentMaintenanceDispatches(tx: Database, now: Date) {
  const candidates = await tx
    .select({ id: equipmentMaintenanceDispatches.id })
    .from(equipmentMaintenanceDispatches)
    .where(
      durablePublicationClaimPredicate(
        {
          status: equipmentMaintenanceDispatches.status,
          availableAt: equipmentMaintenanceDispatches.publishAvailableAt,
          leaseId: equipmentMaintenanceDispatches.publishLeaseId,
          claimedAt: equipmentMaintenanceDispatches.publishClaimedAt,
        },
        now,
      ),
    )
    .orderBy(
      asc(equipmentMaintenanceDispatches.publishAvailableAt),
      asc(equipmentMaintenanceDispatches.createdAt),
      asc(equipmentMaintenanceDispatches.id),
    )
    .limit(DURABLE_PUBLICATION_BATCH_SIZE)
    .for('update', { skipLocked: true })
  if (candidates.length === 0) return []

  const claimed = await tx
    .update(equipmentMaintenanceDispatches)
    .set({
      publishLeaseId: sql`gen_random_uuid()`,
      publishClaimedAt: now,
      publishAttempts: sql`${equipmentMaintenanceDispatches.publishAttempts} + 1`,
      error: null,
    })
    .where(
      and(
        eq(equipmentMaintenanceDispatches.status, 'queued'),
        inArray(
          equipmentMaintenanceDispatches.id,
          candidates.map(({ id }) => id),
        ),
      ),
    )
    .returning()
  return claimed.map((dispatch) => {
    if (!dispatch.publishLeaseId) {
      throw new Error(
        `Equipment maintenance dispatch ${dispatch.id} was locked but could not be leased`,
      )
    }
    return { ...dispatch, publishLeaseId: dispatch.publishLeaseId }
  })
}

/** Publish durable due-cycle snapshots and stamp only the exact cycles sent. */
export async function publishQueuedEquipmentMaintenance(): Promise<{
  published: number
  errors: number
}> {
  const result = { published: 0, errors: 0 }
  const queued = await withSuperAdmin(db, (tx) =>
    claimQueuedEquipmentMaintenanceDispatches(tx, new Date()),
  )
  for (const dispatch of queued) {
    const [owned] = await withSuperAdmin(db, (tx) =>
      tx
        .update(equipmentMaintenanceDispatches)
        .set({ publishClaimedAt: new Date() })
        .where(
          and(
            eq(equipmentMaintenanceDispatches.id, dispatch.id),
            eq(equipmentMaintenanceDispatches.status, 'queued'),
            eq(equipmentMaintenanceDispatches.publishLeaseId, dispatch.publishLeaseId),
          ),
        )
        .returning({ id: equipmentMaintenanceDispatches.id }),
    )
    if (!owned) continue

    if (dispatch.entries.length === 0) {
      result.errors += 1
      await withSuperAdmin(db, (tx) =>
        tx
          .update(equipmentMaintenanceDispatches)
          .set({
            status: 'failed',
            error: 'Equipment maintenance dispatch has no entries',
            publishLeaseId: null,
            publishClaimedAt: null,
          })
          .where(
            and(
              eq(equipmentMaintenanceDispatches.id, dispatch.id),
              eq(equipmentMaintenanceDispatches.status, 'queued'),
              eq(equipmentMaintenanceDispatches.publishLeaseId, dispatch.publishLeaseId),
            ),
          ),
      )
      continue
    }
    try {
      await emitEquipmentMaintenanceDue(dispatch.tenantId, dispatch.entries, dispatch.deliveryKey)
      const finalized = await withTenant(db, dispatch.tenantId, async (tx) => {
        // Lock and re-check the exact lease before stamping source cycles. A
        // very slow delivery may outlive its lease and be reclaimed; the old
        // publisher must not mutate source rows after losing ownership.
        const [owned] = await tx
          .select({ id: equipmentMaintenanceDispatches.id })
          .from(equipmentMaintenanceDispatches)
          .where(
            and(
              eq(equipmentMaintenanceDispatches.id, dispatch.id),
              eq(equipmentMaintenanceDispatches.status, 'queued'),
              eq(equipmentMaintenanceDispatches.publishLeaseId, dispatch.publishLeaseId),
            ),
          )
          .for('update')
          .limit(1)
        if (!owned) return false

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
          .set({
            status: 'enqueued',
            error: null,
            publishLeaseId: null,
            publishClaimedAt: null,
          })
          .where(
            and(
              eq(equipmentMaintenanceDispatches.id, dispatch.id),
              eq(equipmentMaintenanceDispatches.status, 'queued'),
              eq(equipmentMaintenanceDispatches.publishLeaseId, dispatch.publishLeaseId),
            ),
          )
        return true
      })
      if (finalized) result.published += 1
    } catch (error) {
      result.errors += 1
      const failedAt = new Date()
      await withSuperAdmin(db, (tx) =>
        tx
          .update(equipmentMaintenanceDispatches)
          .set({
            error: durablePublicationError(error, 'Equipment maintenance delivery failed'),
            publishAvailableAt: durablePublicationRetryAt(dispatch.publishAttempts, failedAt),
            publishLeaseId: null,
            publishClaimedAt: null,
          })
          .where(
            and(
              eq(equipmentMaintenanceDispatches.id, dispatch.id),
              eq(equipmentMaintenanceDispatches.status, 'queued'),
              eq(equipmentMaintenanceDispatches.publishLeaseId, dispatch.publishLeaseId),
            ),
          ),
      )
    }
  }
  return result
}
