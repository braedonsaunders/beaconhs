// Unified compliance scan — the single detection brain. A FREQUENT global tick
// (every minute) walks each tenant and self-gates against that tenant's
// configured detection schedule (`tenant_notification_policy.scan_cron`,
// evaluated in `scan_timezone`) — the same pattern the digest + scheduled-flow
// scans use. When a tenant is due, re-materialise every active obligation into
// compliance_status (the scoreboard the hub reads) and emit PERSON-TARGETED
// alerts for the subjects whose status changed this run (pending→overdue,
// →expiring). Firing only on transitions means a still-overdue item never
// re-spams; running twice in the same minute is harmless (the second pass sees
// no transition). Tenants that never touched their schedule keep the legacy
// daily-06:00-UTC cadence via the defaults.

import { eq } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { tenantNotificationPolicy, tenants } from '@beaconhs/db/schema'
import { materializeTenant } from '@beaconhs/compliance'
import { emitComplianceTransitions } from '@beaconhs/events'
import { parseCron, type CronFields } from './form-assignment-scanner'

const DEFAULT_CRON = '0 6 * * *'
const DEFAULT_TZ = 'UTC'

export type ComplianceScanResult = {
  tenants: number
  due: number
  obligations: number
  reminders: number
  errors: number
}

// Wall-clock fields in `tz`, so a tenant's "06:00" means their local 06:00, not
// UTC. Falls back to UTC for an unknown/empty zone.
function fieldsInZone(now: Date, tz: string) {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(now)
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = fmt(tz || 'UTC')
  } catch {
    parts = fmt('UTC')
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const dow: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  return {
    minute: Number(get('minute')),
    hour: Number(get('hour')) % 24, // hour12:false can emit '24' at midnight in some ICU builds
    dayOfMonth: Number(get('day')),
    month: Number(get('month')),
    dayOfWeek: dow[get('weekday')] ?? 0,
  }
}

function cronDueNow(cron: string, tz: string, now: Date): boolean {
  let f: CronFields
  try {
    f = parseCron(cron)
  } catch {
    return false
  }
  const t = fieldsInZone(now, tz)
  return (
    f.minute.includes(t.minute) &&
    f.hour.includes(t.hour) &&
    f.dayOfMonth.includes(t.dayOfMonth) &&
    f.month.includes(t.month) &&
    f.dayOfWeek.includes(t.dayOfWeek)
  )
}

export async function scanCompliance(): Promise<ComplianceScanResult> {
  const result: ComplianceScanResult = {
    tenants: 0,
    due: 0,
    obligations: 0,
    reminders: 0,
    errors: 0,
  }
  const now = new Date()

  // One cross-tenant read of each tenant's detection schedule (left join: tenants
  // with no policy row fall back to the legacy default). Guarded so a pre-DDL
  // window can never break the whole scan.
  let schedules: { id: string; cron: string; tz: string }[]
  try {
    const rows = await withSuperAdmin(db, (tx) =>
      tx
        .select({
          id: tenants.id,
          cron: tenantNotificationPolicy.scanCron,
          tz: tenantNotificationPolicy.scanTimezone,
        })
        .from(tenants)
        .leftJoin(tenantNotificationPolicy, eq(tenantNotificationPolicy.tenantId, tenants.id)),
    )
    schedules = rows.map((r) => ({
      id: r.id,
      cron: r.cron ?? DEFAULT_CRON,
      tz: r.tz ?? DEFAULT_TZ,
    }))
  } catch {
    const rows = await withSuperAdmin(db, (tx) => tx.select({ id: tenants.id }).from(tenants))
    schedules = rows.map((r) => ({ id: r.id, cron: DEFAULT_CRON, tz: DEFAULT_TZ }))
  }

  for (const s of schedules) {
    result.tenants += 1
    if (!cronDueNow(s.cron, s.tz, now)) continue
    result.due += 1

    let materialized: Awaited<ReturnType<typeof materializeTenant>> = []
    try {
      // Per-tenant RLS context so reads + the compliance_status upsert are scoped.
      materialized = await withTenant(db, s.id, (tx) => materializeTenant(tx, s.id))
    } catch (err) {
      result.errors += 1
      console.warn(
        `[compliance_scan] tenant ${s.id} failed: ${err instanceof Error ? err.message : err}`,
      )
      continue
    }
    result.obligations += materialized.length
    for (const { obligation, transitions } of materialized) {
      const actionable = transitions.filter((t) => t.to === 'overdue' || t.to === 'expiring')
      if (actionable.length > 0) {
        await emitComplianceTransitions(s.id, obligation.id, actionable)
        result.reminders += 1
      }
    }
  }
  return result
}
