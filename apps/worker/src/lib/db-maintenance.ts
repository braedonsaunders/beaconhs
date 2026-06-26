import { eq, sql } from 'drizzle-orm'
import {
  db,
  withSuperAdmin,
  MAINTENANCE_TABLES,
  resolveRetentionDays,
  type DbMaintenanceSettings,
  type DbMaintenanceLastRun,
  type DbMaintenancePerTableResult,
} from '@beaconhs/db'
import { PLATFORM_SETTINGS_ID, platformSettings } from '@beaconhs/db/schema'

// Database maintenance executor. Prunes each unbounded table past its configured
// retention window and refreshes planner statistics, then records the run on
// platform_settings.database so the /platform/database UI can show last-run
// status. Runs as the BYPASSRLS super role so the retention DELETE spans every
// tenant (these are append-only log/ledger tables — pruning is non-destructive to
// live operations). Deletes are batched to keep locks short on large tables.

const DELETE_BATCH = 5000

export type DbMaintenanceResult = {
  ok: boolean
  durationMs: number
  perTable: DbMaintenancePerTableResult[]
}

async function readSettings(): Promise<DbMaintenanceSettings> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ database: platformSettings.database })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    return (row?.database as DbMaintenanceSettings | undefined) ?? {}
  })
}

async function pruneTable(table: string, timeCol: string, retentionDays: number): Promise<number> {
  const days = Math.max(1, Math.floor(retentionDays))
  let total = 0
  for (;;) {
    const deleted = await withSuperAdmin(db, async (tx) => {
      const res = await tx.execute(
        sql.raw(
          `WITH doomed AS (
             SELECT ctid FROM ${table}
             WHERE ${timeCol} < now() - interval '${days} days'
             LIMIT ${DELETE_BATCH}
           ), del AS (
             DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM doomed) RETURNING 1
           )
           SELECT count(*)::int AS n FROM del`,
        ),
      )
      const rows = (res as { rows?: { n: number }[] }).rows ?? (res as unknown as { n: number }[])
      return Number(rows?.[0]?.n ?? 0)
    })
    total += deleted
    if (deleted < DELETE_BATCH) break
  }
  return total
}

async function analyzeTable(table: string): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    await tx.execute(sql.raw(`ANALYZE ${table}`))
  })
}

async function writeLastRun(lastRun: DbMaintenanceLastRun): Promise<void> {
  const current = await readSettings()
  const next: DbMaintenanceSettings = { ...current, lastRun }
  await withSuperAdmin(db, async (tx) => {
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, database: next as Record<string, unknown> })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: { database: next as Record<string, unknown> },
      })
  })
}

export async function runDatabaseMaintenance(
  trigger: 'scheduled' | 'manual' = 'scheduled',
): Promise<DbMaintenanceResult> {
  const startedAt = Date.now()
  const settings = await readSettings()
  const perTable: DbMaintenancePerTableResult[] = []

  for (const t of MAINTENANCE_TABLES) {
    const retentionDays = resolveRetentionDays(settings, t)
    const result: DbMaintenancePerTableResult = {
      table: t.table,
      deleted: 0,
      analyzed: false,
      retentionDays,
    }
    try {
      if (retentionDays != null && retentionDays > 0) {
        result.deleted = await pruneTable(t.table, t.timeColumn, retentionDays)
      }
      await analyzeTable(t.table)
      result.analyzed = true
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e)
    }
    perTable.push(result)
  }

  const lastRun: DbMaintenanceLastRun = {
    at: new Date().toISOString(),
    ok: perTable.every((r) => !r.error),
    durationMs: Date.now() - startedAt,
    trigger,
    perTable,
  }
  await writeLastRun(lastRun)

  const totalDeleted = perTable.reduce((n, r) => n + r.deleted, 0)
  console.log(
    `[scheduled] db_maintenance(${trigger}): ${totalDeleted} rows pruned across ${perTable.length} tables in ${lastRun.durationMs}ms${lastRun.ok ? '' : ' (with errors)'}`,
  )
  return { ok: lastRun.ok, durationMs: lastRun.durationMs, perTable }
}
