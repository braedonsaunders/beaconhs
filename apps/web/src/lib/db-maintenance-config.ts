// Database maintenance configuration (super-admin; deployment-wide). Per-table
// retention windows for the unbounded, append-heavy tables live in
// platform_settings.database as a DbMaintenanceSettings; the nightly
// db_maintenance worker job prunes rows past each window and refreshes planner
// statistics, then stamps its result back into the same row (lastRun).
//
// platform_settings is a GLOBAL table (no RLS — see schema/platform-settings.ts),
// but the size/row probes below hit RLS-protected tables (audit_log, *_log, …),
// so every read here runs on the dedicated BYPASSRLS pool via withSuperAdmin().

import { eq, sql } from 'drizzle-orm'
import {
  db,
  withSuperAdmin,
  MAINTENANCE_TABLES,
  type DbMaintenanceSettings,
  type DbTableSetting,
} from '@beaconhs/db'
import { platformSettings, PLATFORM_SETTINGS_ID } from '@beaconhs/db/schema'

type SizeRow = {
  bytes: string | number | null
  pretty: string | null
  rows: string | number | null
}

// drizzle's postgres-js execute() returns rows differently across versions:
// some return an array directly, others wrap it in `{ rows }`. Mirror the
// worker's defensive extraction (apps/worker/src/lib/db-maintenance.ts).
function firstRow<T>(res: unknown): T | undefined {
  const arr = (res as { rows?: T[] }).rows ?? (res as T[])
  return Array.isArray(arr) ? arr[0] : undefined
}

/** Live retention settings + last-run status from platform_settings.database. */
export async function getDbMaintenanceSettings(): Promise<DbMaintenanceSettings> {
  return withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ database: platformSettings.database })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const raw = row?.database
    return (raw && typeof raw === 'object' ? raw : {}) as DbMaintenanceSettings
  })
}

/**
 * Merge per-table retention windows into platform_settings.database.tables,
 * preserving the last-run status, and upsert the single settings row.
 */
export async function saveDbMaintenanceRetention(
  tables: Record<string, DbTableSetting>,
): Promise<void> {
  await withSuperAdmin(db, async (tx) => {
    const [row] = await tx
      .select({ database: platformSettings.database })
      .from(platformSettings)
      .where(eq(platformSettings.id, PLATFORM_SETTINGS_ID))
      .limit(1)
    const prev = (
      row?.database && typeof row.database === 'object' ? row.database : {}
    ) as DbMaintenanceSettings
    const next: DbMaintenanceSettings = { ...prev, tables }
    await tx
      .insert(platformSettings)
      .values({ id: PLATFORM_SETTINGS_ID, database: next })
      .onConflictDoUpdate({ target: platformSettings.id, set: { database: next } })
  })
}

export type MaintenanceTableSize = {
  table: string
  rows: number
  totalBytes: number
  prettySize: string
}

/**
 * Live on-disk size + estimated row count for each maintained table. Estimates
 * come from pg_class.reltuples (cheap; refreshed by ANALYZE / the nightly job)
 * rather than an exact count(*) on tables that can hold millions of rows.
 */
export async function getMaintenanceTableSizes(): Promise<MaintenanceTableSize[]> {
  return withSuperAdmin(db, async (tx) => {
    const sizes: MaintenanceTableSize[] = []
    for (const t of MAINTENANCE_TABLES) {
      const result = await tx.execute(
        sql`select
          pg_total_relation_size(${t.table}::regclass) as bytes,
          pg_size_pretty(pg_total_relation_size(${t.table}::regclass)) as pretty,
          (select reltuples::bigint from pg_class where relname = ${t.table}) as rows`,
      )
      const r = firstRow<SizeRow>(result)
      const rows = Math.max(0, Number(r?.rows ?? 0))
      const totalBytes = Number(r?.bytes ?? 0)
      sizes.push({
        table: t.table,
        rows: Number.isFinite(rows) ? rows : 0,
        totalBytes: Number.isFinite(totalBytes) ? totalBytes : 0,
        prettySize: r?.pretty ?? '0 bytes',
      })
    }
    return sizes
  })
}
