// runSync — the execution orchestrator. Pull (network, no tx) → upsert in
// tenant-scoped batches (RLS) → record a sync_runs ledger row + denormalise the
// last-run summary onto the connection. Called by the worker (scheduled or
// manual) and reusable inline.

import { and, eq, isNull } from 'drizzle-orm'
import { type Database, withTenant } from '@beaconhs/db'
import {
  type SyncEntityStat,
  type SyncRunLogLine,
  type SyncRunStatus,
  syncConnections,
  syncRuns,
} from '@beaconhs/db/schema'
import { unsealSecret } from './crypto'
import { getConnector } from './registry'
import { loadLookups, upsertRecord } from './upsert'
import type { CanonicalRecord, ConnectorRunContext, SyncLogger } from './types'

const BATCH = 250

function emptyStat(): SyncEntityStat {
  return { pulled: 0, created: 0, updated: 0, unchanged: 0, skipped: 0, failed: 0 }
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

export interface RunSyncArgs {
  db: Database
  tenantId: string
  connectionId: string
  trigger: 'scheduled' | 'manual'
}

export interface RunSyncResult {
  runId: string | null
  status: SyncRunStatus
  stats: Record<string, SyncEntityStat>
  error: string | null
}

export async function runSync(args: RunSyncArgs): Promise<RunSyncResult> {
  const { db, tenantId, connectionId, trigger } = args

  const conn = await withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .select()
      .from(syncConnections)
      .where(and(eq(syncConnections.id, connectionId), isNull(syncConnections.deletedAt)))
      .limit(1)
    return c ?? null
  })
  if (!conn) return { runId: null, status: 'error', stats: {}, error: 'Connection not found.' }

  const logLines: SyncRunLogLine[] = []
  const log: SyncLogger = (level, msg) => {
    logLines.push({ at: new Date().toISOString(), level, msg })
    const line = `[sync ${conn.connectorKey} ${connectionId.slice(0, 8)}] ${msg}`
    if (level === 'error') console.error(line)
    else console.log(line)
  }

  const startedAt = new Date()
  const runId = await withTenant(db, tenantId, async (tx) => {
    const [r] = await tx
      .insert(syncRuns)
      .values({ tenantId, connectionId, trigger, status: 'running', startedAt })
      .returning({ id: syncRuns.id })
    return r?.id ?? null
  })

  const finalize = async (
    status: SyncRunStatus,
    stats: Record<string, SyncEntityStat>,
    error: string | null,
  ): Promise<RunSyncResult> => {
    const completedAt = new Date()
    await withTenant(db, tenantId, async (tx) => {
      if (runId) {
        await tx
          .update(syncRuns)
          .set({
            status,
            completedAt,
            durationMs: completedAt.getTime() - startedAt.getTime(),
            stats,
            error,
            log: logLines,
          })
          .where(eq(syncRuns.id, runId))
      }
      await tx
        .update(syncConnections)
        .set({
          lastRunId: runId,
          lastRunAt: completedAt,
          lastStatus: status,
          lastError: error,
          status: status === 'error' ? 'error' : 'connected',
        })
        .where(eq(syncConnections.id, connectionId))
    })
    return { runId, status, stats, error }
  }

  const connector = getConnector(conn.connectorKey)
  if (!connector) {
    log('error', `Unknown connector "${conn.connectorKey}".`)
    return finalize('error', {}, `Unknown connector "${conn.connectorKey}".`)
  }

  const secrets: Record<string, string> = {}
  for (const [k, sealed] of Object.entries(conn.secrets ?? {})) {
    const v = unsealSecret(sealed)
    if (v != null) secrets[k] = v
  }

  const ctx: ConnectorRunContext = {
    tenantId,
    connectionId,
    config: conn.config ?? {},
    secrets,
    since: null,
    log,
  }

  let records: CanonicalRecord[]
  try {
    log('info', 'Pulling records…')
    records = await connector.pull(ctx)
    log('info', `Pulled ${records.length} record(s).`)
  } catch (e) {
    const m = errMsg(e)
    log('error', `Pull failed: ${m}`)
    return finalize('error', {}, m)
  }

  const stats: Record<string, SyncEntityStat> = {}
  const lookups = await withTenant(db, tenantId, (tx) => loadLookups(tx))

  for (const batch of chunk(records, BATCH)) {
    try {
      await withTenant(db, tenantId, async (tx) => {
        for (const rec of batch) {
          const s = (stats[rec.entity] ??= emptyStat())
          s.pulled++
          try {
            const res = await upsertRecord(
              tx,
              { tenantId, connectionId, sourceSystem: conn.connectorKey, lookups, log },
              rec,
            )
            s[res.action]++
          } catch (e) {
            s.failed++
            log('error', `${rec.entity} "${rec.externalId}": ${errMsg(e)}`)
          }
        }
      })
    } catch (e) {
      for (const rec of batch) {
        const s = (stats[rec.entity] ??= emptyStat())
        s.failed++
      }
      log('error', `Batch failed: ${errMsg(e)}`)
    }
  }

  const failed = Object.values(stats).reduce((a, s) => a + s.failed, 0)
  const status: SyncRunStatus = failed > 0 ? 'partial' : 'success'
  return finalize(status, stats, failed > 0 ? `${failed} record(s) failed.` : null)
}
