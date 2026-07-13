// External data-sync scheduling. The 15-minute `sync_scan` tick finds enabled
// connections whose cadence is due (relative to lastRunAt) and enqueues a
// `sync_run` tick per connection. `sync_run` executes one connection via the
// @beaconhs/sync orchestrator (pull → upsert → ledger).
//
// Overlap protection: `lastRunAt` is only stamped when a run FINISHES, so a run
// that outlives the scan interval would look due again. Two guards prevent a
// second concurrent run for the same connection: (1) a connection with an
// in-flight sync_runs row (status='running', started within the stall window)
// is not due; (2) the enqueue uses a deterministic per-connection jobId so
// BullMQ dedupes while a run is queued or executing (the job removes itself on
// completion/failure, freeing the id for the next cadence).

import { and, eq, gte, inArray, isNull } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { syncConnections, syncRuns } from '@beaconhs/db/schema'
import { enqueueScheduled, type ScheduledTick } from '@beaconhs/jobs'
import { type RunSyncResult, runSync } from '@beaconhs/sync'

// Friendly cadence keys (stored in sync_connections.schedule) → minutes.
const CADENCE_MINUTES: Record<string, number> = {
  '15min': 15,
  hourly: 60,
  '6h': 360,
  daily: 1440,
  weekly: 10080,
}

// A 'running' row older than this is treated as a crashed run (worker died
// before finalize) and no longer blocks scheduling.
const STALLED_RUN_MINUTES = 6 * 60

type SyncScanResult = { candidates: number; enqueued: number }

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
  if (conns.length === 0) return result

  // Connections with a live in-flight run — skipped this tick.
  const stallCutoff = new Date(now.getTime() - STALLED_RUN_MINUTES * 60_000)
  const runningRows = await withSuperAdmin(db, (tx) =>
    tx
      .select({ connectionId: syncRuns.connectionId })
      .from(syncRuns)
      .where(
        and(
          inArray(
            syncRuns.connectionId,
            conns.map((c) => c.id),
          ),
          eq(syncRuns.status, 'running'),
          gte(syncRuns.startedAt, stallCutoff),
        ),
      ),
  )
  const inFlight = new Set(runningRows.map((r) => r.connectionId))

  for (const c of conns) {
    result.candidates += 1
    const mins = c.schedule ? CADENCE_MINUTES[c.schedule] : undefined
    if (!mins) continue
    if (inFlight.has(c.id)) continue
    const due = !c.lastRunAt || now.getTime() - c.lastRunAt.getTime() >= mins * 60_000
    if (!due) continue
    await enqueueScheduled(
      'sync_run',
      {
        kind: 'sync_run',
        tenantId: c.tenantId,
        connectionId: c.id,
        trigger: 'scheduled',
      } as ScheduledTick,
      // Deterministic id: while a run for this connection is queued/active the
      // add is a no-op. removeOnComplete/removeOnFail free the id afterwards
      // (the sync_runs ledger is the durable history, not BullMQ).
      // BullMQ rejects custom job ids containing a colon (except a legacy
      // three-segment repeat-job shape). Use the platform's `|` delimiter.
      { jobId: `sync-run|${c.id}`, removeOnComplete: true, removeOnFail: true },
    )
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
