// External data-sync scheduling. The 15-minute `sync_scan` tick finds enabled
// connections whose cadence is due (relative to lastRunAt) and enqueues a
// `sync_run` tick per connection. `sync_run` executes one connection via the
// @beaconhs/sync orchestrator (pull → upsert → ledger).

import { and, eq, isNull } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { syncConnections } from '@beaconhs/db/schema'
import { type ScheduledTick, scheduledQueue } from '@beaconhs/jobs'
import { type RunSyncResult, runSync } from '@beaconhs/sync'

// Friendly cadence keys (stored in sync_connections.schedule) → minutes.
const CADENCE_MINUTES: Record<string, number> = {
  '15min': 15,
  hourly: 60,
  '6h': 360,
  daily: 1440,
  weekly: 10080,
}

export type SyncScanResult = { candidates: number; enqueued: number }

export async function scanSyncConnections(now: Date = new Date()): Promise<SyncScanResult> {
  const result: SyncScanResult = { candidates: 0, enqueued: 0 }
  const conns = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        id: syncConnections.id,
        tenantId: syncConnections.tenantId,
        schedule: syncConnections.schedule,
        lastRunAt: syncConnections.lastRunAt,
      })
      .from(syncConnections)
      .where(and(eq(syncConnections.enabled, true), isNull(syncConnections.deletedAt))),
  )
  for (const c of conns) {
    result.candidates += 1
    const mins = c.schedule ? CADENCE_MINUTES[c.schedule] : undefined
    if (!mins) continue
    const due = !c.lastRunAt || now.getTime() - c.lastRunAt.getTime() >= mins * 60_000
    if (!due) continue
    await scheduledQueue.add('sync_run', {
      kind: 'sync_run',
      tenantId: c.tenantId,
      connectionId: c.id,
      trigger: 'scheduled',
    } as ScheduledTick)
    result.enqueued += 1
  }
  return result
}

export async function runSyncConnection(
  tenantId: string,
  connectionId: string,
  trigger: 'scheduled' | 'manual',
): Promise<RunSyncResult> {
  return runSync({ db, tenantId, connectionId, trigger })
}
