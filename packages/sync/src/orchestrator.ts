// runSync — the execution orchestrator. Pull (network, no tx) → upsert in
// tenant-scoped batches (RLS) → record run + per-record ledgers. Called by the
// worker (scheduled/manual) and by admin preview actions.

import { and, eq, isNull } from 'drizzle-orm'
import { type Database, withTenant } from '@beaconhs/db'
import {
  type SyncEntityKey,
  type SyncEntityStat,
  type SyncRecordAction,
  type SyncRunLogLine,
  type SyncRunStatus,
  syncConnections,
  syncRecordChanges,
  syncRuns,
} from '@beaconhs/db/schema'
import { unsealSecret } from '@beaconhs/crypto'
import { getConnector } from './registry'
import {
  archiveMissingRecords,
  loadLookups,
  upsertRecord,
  type SyncOwnershipMode,
  type UpsertResult,
} from './upsert'
import type { CanonicalRecord, ConnectorPullResult, ConnectorRunContext, SyncLogger } from './types'
import { planSnapshotArchives } from './snapshot-policy'

const BATCH = 250

type MissingPolicy = 'keep' | 'archive'

type SyncPolicy = {
  missing?: MissingPolicy
  ownership?: SyncOwnershipMode
}

function emptyStat(): SyncEntityStat {
  return {
    pulled: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
    archived: 0,
    conflict: 0,
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function policyOf(config: Record<string, unknown>): Required<SyncPolicy> {
  const raw = config.syncPolicy as SyncPolicy | undefined
  return {
    missing: raw?.missing === 'archive' ? 'archive' : 'keep',
    ownership: raw?.ownership === 'manual_wins' ? 'manual_wins' : 'source_wins',
  }
}

function normalizePull(
  pulled: CanonicalRecord[] | ConnectorPullResult,
): Required<ConnectorPullResult> {
  if (Array.isArray(pulled)) {
    return {
      records: pulled,
      nextCursor: null,
      mode: 'full',
      authoritativeEntities: [...new Set(pulled.map((record) => record.entity))],
    }
  }
  return {
    records: pulled.records,
    nextCursor: pulled.nextCursor ?? null,
    mode: pulled.mode ?? 'full',
    authoritativeEntities: pulled.authoritativeEntities ?? [
      ...new Set(pulled.records.map((record) => record.entity)),
    ],
  }
}

function actionStat(
  stats: Record<string, SyncEntityStat>,
  entity: SyncEntityKey,
  action: SyncRecordAction,
) {
  const s = (stats[entity] ??= emptyStat())
  if (action in s) s[action as keyof SyncEntityStat] += 1
}

export interface RunSyncArgs {
  db: Database
  tenantId: string
  connectionId: string
  trigger: 'scheduled' | 'manual' | 'preview'
  dryRun?: boolean
}

export interface RunSyncResult {
  runId: string | null
  status: SyncRunStatus
  stats: Record<string, SyncEntityStat>
  error: string | null
}

export async function runSync(args: RunSyncArgs): Promise<RunSyncResult> {
  const { db, tenantId, connectionId, trigger } = args
  const dryRun = args.dryRun ?? trigger === 'preview'

  const conn = await withTenant(db, tenantId, async (tx) => {
    const [c] = await tx
      .select()
      .from(syncConnections)
      .where(and(eq(syncConnections.id, connectionId), isNull(syncConnections.deletedAt)))
      .limit(1)
    return c ?? null
  })
  if (!conn) return { runId: null, status: 'error', stats: {}, error: 'Connection not found.' }

  const config = (conn.config as Record<string, unknown>) ?? {}
  const policy = policyOf(config)
  const cursorBefore = (conn.cursor as Record<string, unknown>) ?? {}
  const logLines: SyncRunLogLine[] = []
  const log: SyncLogger = (level, msg) => {
    logLines.push({ at: new Date().toISOString(), level, msg })
    const preview = dryRun ? ' preview' : ''
    const line = `[sync${preview} ${conn.connectorKey} ${connectionId.slice(0, 8)}] ${msg}`
    if (level === 'error') console.error(line)
    else console.log(line)
  }

  const startedAt = new Date()
  const runId = await withTenant(db, tenantId, async (tx) => {
    const [r] = await tx
      .insert(syncRuns)
      .values({
        tenantId,
        connectionId,
        trigger,
        dryRun,
        status: 'running',
        startedAt,
        cursorBefore,
        cursorAfter: cursorBefore,
      })
      .returning({ id: syncRuns.id })
    return r?.id ?? null
  })

  const finalize = async (
    status: SyncRunStatus,
    stats: Record<string, SyncEntityStat>,
    error: string | null,
    cursorAfter: Record<string, unknown> = cursorBefore,
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
            cursorAfter,
            error,
            log: logLines,
          })
          .where(eq(syncRuns.id, runId))
      }
      if (dryRun) {
        await tx
          .update(syncConnections)
          .set({
            status: status === 'error' ? 'error' : 'connected',
            lastError: status === 'error' ? error : null,
          })
          .where(eq(syncConnections.id, connectionId))
      } else {
        // Only advance the cursor on a clean run. On 'error' or 'partial' keep
        // cursorBefore so any failed rows fall back inside the next pull's
        // window and are re-covered — upserts are idempotent via the crosswalk,
        // so re-pulling already-succeeded rows is a no-op.
        const advanceCursor = status === 'success'
        await tx
          .update(syncConnections)
          .set({
            cursor: advanceCursor ? cursorAfter : cursorBefore,
            lastRunId: runId,
            lastRunAt: completedAt,
            lastStatus: status,
            lastError: error,
            status: status === 'error' ? 'error' : 'connected',
          })
          .where(eq(syncConnections.id, connectionId))
      }
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
    config,
    secrets,
    since: cursorBefore,
    log,
  }

  let pulled: Required<ConnectorPullResult>
  try {
    log('info', dryRun ? 'Previewing source records...' : 'Pulling records...')
    pulled = normalizePull(await connector.pull(ctx))
    log('info', `Pulled ${pulled.records.length} record(s).`)
  } catch (e) {
    const m = errMsg(e)
    log('error', `Pull failed: ${m}`)
    return finalize('error', {}, m)
  }

  const records = pulled.records
  const cursorAfter = pulled.nextCursor ? pulled.nextCursor : cursorBefore
  const stats: Record<string, SyncEntityStat> = {}
  const seen: Record<SyncEntityKey, Set<string>> = {
    people: new Set(),
    org_unit: new Set(),
    equipment: new Set(),
    contact: new Set(),
  }
  let lookups: Awaited<ReturnType<typeof loadLookups>>
  try {
    lookups = await withTenant(db, tenantId, (tx) => loadLookups(tx))
  } catch (error) {
    const message = `Failed to load sync lookups: ${errMsg(error)}`
    log('error', message)
    return finalize('error', {}, message)
  }

  async function recordChange(
    tx: Database,
    rec: CanonicalRecord,
    res: UpsertResult | { action: 'failed'; message: string },
  ) {
    if (!runId) return
    await tx.insert(syncRecordChanges).values({
      tenantId,
      connectionId,
      runId,
      entity: rec.entity,
      externalId: rec.externalId,
      canonicalId: 'canonicalId' in res ? (res.canonicalId ?? null) : null,
      action: res.action,
      dryRun,
      rowHash: 'rowHash' in res ? (res.rowHash ?? null) : null,
      before: 'before' in res ? (res.before ?? null) : null,
      after: 'after' in res ? (res.after ?? null) : null,
      diff: 'diff' in res ? (res.diff ?? null) : null,
      message: 'message' in res ? (res.message ?? null) : null,
    })
  }

  for (const batch of chunk(records, BATCH)) {
    // Accumulate stats + seen ids into a batch-local delta and merge them into
    // the run totals only after the transaction commits. If the batch tx throws
    // every DB write rolls back, so keeping the in-memory counts would claim
    // creations/updates that never landed and mark the rolled-back ids as seen
    // (which the archive policy would then honour). On rollback we merge only a
    // per-record failed count instead.
    const batchStats: Record<string, SyncEntityStat> = {}
    const batchSeen: Record<SyncEntityKey, Set<string>> = {
      people: new Set(),
      org_unit: new Set(),
      equipment: new Set(),
      contact: new Set(),
    }
    try {
      await withTenant(db, tenantId, async (tx) => {
        for (const rec of batch) {
          const s = (batchStats[rec.entity] ??= emptyStat())
          s.pulled++
          batchSeen[rec.entity].add(rec.externalId)
          try {
            // Per-record savepoint: a failing upsert (e.g. a unique-constraint
            // violation) rolls back only this record. Without it the first
            // failure poisons the whole batch transaction — every later write,
            // including the failure ledger insert, then errors and the entire
            // batch (up to BATCH records, across all entities) is marked failed.
            const res = await tx.transaction(async (spTx) => {
              const sp = spTx as unknown as Database
              const r = await upsertRecord(
                sp,
                {
                  tenantId,
                  connectionId,
                  sourceSystem: conn.connectorKey,
                  lookups,
                  log,
                  dryRun,
                  ownershipMode: policy.ownership,
                },
                rec,
              )
              await recordChange(sp, rec, r)
              return r
            })
            actionStat(batchStats, rec.entity, res.action)
          } catch (e) {
            const message = errMsg(e)
            s.failed++
            log('error', `${rec.entity} "${rec.externalId}": ${message}`)
            // The savepoint rolled back but the batch tx is still healthy, so
            // the failure ledger row commits with the real error message.
            await recordChange(tx, rec, { action: 'failed', message })
          }
        }
      })
      // Committed — fold the batch delta into the run totals.
      for (const [entity, bs] of Object.entries(batchStats)) {
        const s = (stats[entity] ??= emptyStat())
        for (const k of Object.keys(bs) as (keyof SyncEntityStat)[]) s[k] += bs[k]
      }
      for (const entity of Object.keys(batchSeen) as SyncEntityKey[]) {
        for (const id of batchSeen[entity]) seen[entity].add(id)
      }
    } catch (e) {
      // Rolled back — nothing landed; count only failures for the batch.
      for (const rec of batch) {
        const s = (stats[rec.entity] ??= emptyStat())
        s.failed++
      }
      log('error', `Batch failed: ${errMsg(e)}`)
    }
  }

  const processingFailures = Object.values(stats).reduce((total, stat) => total + stat.failed, 0)
  const archiveSafetyErrors: string[] = []
  if (policy.missing === 'archive' && pulled.mode === 'full') {
    const seenCounts = Object.fromEntries(
      (Object.keys(seen) as SyncEntityKey[]).map((entity) => [entity, seen[entity].size]),
    ) as Record<SyncEntityKey, number>
    const archivePlan = planSnapshotArchives(
      pulled.authoritativeEntities.filter((entity) => entity !== 'contact'),
      seenCounts,
      processingFailures,
    )

    if (archivePlan.blockedByFailures) {
      log('warn', 'Skipping missing-record archive policy because record processing had failures.')
    }
    if (archivePlan.missingAuthority && pulled.authoritativeEntities.length === 0) {
      const message =
        'Missing-record archive skipped because the source identified no full snapshots.'
      log('warn', message)
      archiveSafetyErrors.push(message)
    }
    for (const entity of archivePlan.blockedEmpty) {
      const message = `Missing-record archive blocked for ${entity}: the full snapshot contained no valid records.`
      log('warn', message)
      archiveSafetyErrors.push(message)
    }

    if (archivePlan.eligible.length > 0) {
      try {
        const archivedByEntity = await withTenant(db, tenantId, async (tx) => {
          const committed: Array<{
            entity: SyncEntityKey
            results: Awaited<ReturnType<typeof archiveMissingRecords>>
          }> = []
          for (const entity of archivePlan.eligible) {
            const results = await archiveMissingRecords(
              tx,
              {
                tenantId,
                connectionId,
                sourceSystem: conn.connectorKey,
                lookups,
                log,
                dryRun,
                ownershipMode: policy.ownership,
              },
              entity,
              seen[entity],
            )
            if (runId && results.length > 0) {
              await tx.insert(syncRecordChanges).values(
                results.map((res) => ({
                  tenantId,
                  connectionId,
                  runId,
                  entity,
                  externalId: res.externalId,
                  canonicalId: res.canonicalId,
                  action: res.action,
                  dryRun,
                  rowHash: res.rowHash ?? null,
                  before: res.before,
                  after: res.after,
                  diff: res.diff,
                  message: res.message,
                })),
              )
            }
            committed.push({ entity, results })
          }
          return committed
        })
        for (const { entity, results } of archivedByEntity) {
          for (const _result of results) actionStat(stats, entity, 'archived')
        }
      } catch (error) {
        const message = `Missing-record archive transaction failed: ${errMsg(error)}`
        log('error', message)
        archiveSafetyErrors.push(message)
      }
    }
  } else if (policy.missing === 'archive' && pulled.mode === 'incremental') {
    log('info', 'Skipping missing-record archive policy on incremental pull.')
  }

  const failed = Object.values(stats).reduce((a, s) => a + s.failed, 0)
  const conflicts = Object.values(stats).reduce((a, s) => a + s.conflict, 0)
  const errors: string[] = []
  if (failed > 0) errors.push(`${failed} record(s) failed.`)
  if (conflicts > 0) errors.push(`${conflicts} record(s) need conflict review.`)
  errors.push(...archiveSafetyErrors)
  const status: SyncRunStatus = errors.length > 0 ? 'partial' : 'success'
  const error = errors.length > 0 ? errors.join(' ') : null
  return finalize(status, stats, error, cursorAfter)
}
