// Database maintenance catalog + types, shared by the worker executor
// (apps/worker/src/lib/db-maintenance.ts) and the platform UI
// (/platform/database). The unbounded, append-heavy tables grow forever without
// a retention policy; the db_maintenance job prunes rows past each table's
// configured window and refreshes planner statistics. Retention is configured
// per-table by a super-admin and stored in platform_settings.database.
//
// These tables are append-only logs/ledgers — pruning old rows is non-destructive
// to live operations. Defaults below are conservative HSE retention windows; a
// super-admin can lengthen them or set "keep forever" (null) per table.

export type MaintenanceTable = {
  /** Physical table name. */
  table: string
  /** Timestamp column the retention window is measured against. */
  timeColumn: string
  /** Human label for the platform UI. */
  label: string
  /** Default retention in days; null = keep forever. */
  defaultRetentionDays: number | null
  /** Optional trusted SQL predicate that protects live rows from retention. */
  retentionWhere?: string
}

export const MAINTENANCE_TABLES: MaintenanceTable[] = [
  { table: 'audit_log', timeColumn: 'occurred_at', label: 'Audit log', defaultRetentionDays: 730 },
  {
    table: 'notifications',
    timeColumn: 'occurred_at',
    label: 'Notifications',
    defaultRetentionDays: 180,
  },
  { table: 'email_log', timeColumn: 'created_at', label: 'Email log', defaultRetentionDays: 365 },
  { table: 'sms_log', timeColumn: 'created_at', label: 'SMS log', defaultRetentionDays: 365 },
  {
    table: 'kiosk_scans',
    timeColumn: 'scanned_at',
    label: 'Kiosk sign-in scans',
    defaultRetentionDays: 1095,
  },
  {
    table: 'compliance_dispatches',
    timeColumn: 'occurred_at',
    label: 'Compliance dispatch ledger',
    defaultRetentionDays: 730,
  },
  {
    table: 'domain_event_outbox',
    timeColumn: 'published_at',
    label: 'Published domain events',
    defaultRetentionDays: 365,
    retentionWhere: "status = 'published'",
  },
]

export type DbTableSetting = { retentionDays: number | null }

export type DbMaintenancePerTableResult = {
  table: string
  deleted: number
  analyzed: boolean
  retentionDays: number | null
  error?: string
}

export type DbMaintenanceLastRun = {
  at: string // ISO timestamp
  ok: boolean
  durationMs: number
  trigger: 'scheduled' | 'manual'
  perTable: DbMaintenancePerTableResult[]
}

export type DbMaintenanceSettings = {
  tables?: Record<string, DbTableSetting>
  lastRun?: DbMaintenanceLastRun
}

/** Resolve a table's effective retention (per-table override or catalog default). */
export function resolveRetentionDays(
  settings: DbMaintenanceSettings,
  table: MaintenanceTable,
): number | null {
  const override = settings.tables?.[table.table]?.retentionDays
  return override === undefined ? table.defaultRetentionDays : override
}
