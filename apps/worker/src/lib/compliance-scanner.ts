// Unified compliance scan — the single detection brain. A FREQUENT global tick
// (every minute) walks each tenant and self-gates against that tenant's
// configured detection schedule (`tenant_notification_policy.scan_cron`,
// evaluated in `scan_timezone`) — the same pattern the digest + scheduled-flow
// scans use. When a tenant is due, re-materialise every active obligation into
// compliance_status (the scoreboard the hub reads) and emit PERSON-TARGETED
// alerts for the subjects whose status changed this run (pending→overdue,
// →expiring). Firing only on transitions means a still-overdue item never
// re-spams; running twice in the same minute is harmless (the second pass sees
// no transition). Tenants without a policy row use the documented daily
// 06:00-UTC default.

import { and, asc, eq } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant } from '@beaconhs/db'
import { complianceDispatches, tenantNotificationPolicy, tenants } from '@beaconhs/db/schema'
import { materializeTenant } from '@beaconhs/compliance'
import { emitComplianceTransitions } from '@beaconhs/events'
import {
  publishQueuedEquipmentMaintenance,
  scanTenantEquipmentMaintenance,
} from './equipment-maintenance-scanner'
import { cronOccursAt } from './cron'

const DEFAULT_CRON = '0 6 * * *'
const DEFAULT_TZ = 'UTC'

type ComplianceScanResult = {
  tenants: number
  due: number
  obligations: number
  reminders: number
  /** Equipment maintenance entries alerted (schedules + reminders due). */
  maintenance: number
  errors: number
}

function cronDueNow(cron: string, tz: string, now: Date): boolean {
  try {
    return cronOccursAt(cron, now, tz || 'UTC')
  } catch {
    return false
  }
}

// `scheduledFor` is the minute the tick was SCHEDULED to run (the caller passes
// the BullMQ slot time). Matching against it — instead of the wall clock at
// processing time — means a tick delayed by queue congestion or a retry still
// evaluates the minute it was meant for, so a tenant's daily scan is not
// silently skipped when the tick lands a few minutes late.
export async function scanCompliance(
  scheduledFor: Date = new Date(),
): Promise<ComplianceScanResult> {
  const result: ComplianceScanResult = {
    tenants: 0,
    due: 0,
    obligations: 0,
    reminders: 0,
    maintenance: 0,
    errors: 0,
  }
  const now = scheduledFor

  // One cross-tenant read of each tenant's detection schedule. Deployment runs
  // migrations before starting the worker, so a missing policy table is a hard
  // deployment error rather than a second, silently degraded execution mode.
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
  const schedules = rows.map((r) => ({
    id: r.id,
    cron: r.cron ?? DEFAULT_CRON,
    tz: r.tz ?? DEFAULT_TZ,
  }))

  for (const s of schedules) {
    result.tenants += 1
    if (!cronDueNow(s.cron, s.tz, now)) continue
    result.due += 1

    let materialized: Awaited<ReturnType<typeof materializeTenant>> = []
    try {
      // Per-tenant RLS context so reads + the compliance_status upsert are scoped.
      materialized = await withTenant(db, s.id, async (tx) => {
        const rows = await materializeTenant(tx, s.id)
        for (const { obligation, transitions } of rows) {
          const actionable = transitions.filter((t) => t.to === 'overdue' || t.to === 'expiring')
          if (actionable.length === 0) continue
          const [claimed] = await tx
            .insert(complianceDispatches)
            .values({
              tenantId: s.id,
              obligationId: obligation.id,
              occurredAt: new Date(Math.floor(now.getTime() / 60_000) * 60_000),
              status: 'queued',
              alertPayload: { transitions: actionable },
            })
            .onConflictDoNothing({
              target: [complianceDispatches.obligationId, complianceDispatches.occurredAt],
            })
            .returning({ id: complianceDispatches.id })
          if (claimed) result.reminders += 1
        }
        return rows
      })
    } catch (err) {
      result.errors += 1
      console.warn(
        `[compliance_scan] tenant ${s.id} failed: ${err instanceof Error ? err.message : err}`,
      )
      continue
    }
    result.obligations += materialized.length
    // Equipment maintenance rides the same per-tenant heartbeat — inspection
    // schedules + ad-hoc reminders whose due date arrived alert once per due
    // cycle (see the scanner's due_notified_for stamps).
    try {
      result.maintenance += await scanTenantEquipmentMaintenance(s.id)
    } catch (err) {
      result.errors += 1
      console.warn(
        `[compliance_scan] equipment maintenance for tenant ${s.id} failed: ${err instanceof Error ? err.message : err}`,
      )
    }
  }
  await publishQueuedComplianceDispatches(result)
  const maintenanceDelivery = await publishQueuedEquipmentMaintenance()
  result.errors += maintenanceDelivery.errors
  return result
}

async function publishQueuedComplianceDispatches(result: ComplianceScanResult): Promise<void> {
  const queued = await withSuperAdmin(db, (tx) =>
    tx
      .select()
      .from(complianceDispatches)
      .where(eq(complianceDispatches.status, 'queued'))
      .orderBy(asc(complianceDispatches.createdAt))
      .limit(500),
  )
  for (const dispatch of queued) {
    const transitions = dispatch.alertPayload?.transitions
    if (!transitions?.length) {
      result.errors += 1
      await withSuperAdmin(db, (tx) =>
        tx
          .update(complianceDispatches)
          .set({ status: 'failed', error: 'Queued compliance dispatch has no alert payload' })
          .where(eq(complianceDispatches.id, dispatch.id)),
      )
      continue
    }
    try {
      await emitComplianceTransitions(
        dispatch.tenantId,
        dispatch.obligationId,
        transitions,
        dispatch.id,
      )
      await withSuperAdmin(db, (tx) =>
        tx
          .update(complianceDispatches)
          .set({ status: 'enqueued', error: null })
          .where(
            and(
              eq(complianceDispatches.id, dispatch.id),
              eq(complianceDispatches.status, 'queued'),
            ),
          ),
      )
    } catch (error) {
      result.errors += 1
      await withSuperAdmin(db, (tx) =>
        tx
          .update(complianceDispatches)
          .set({ error: error instanceof Error ? error.message : String(error) })
          .where(eq(complianceDispatches.id, dispatch.id)),
      )
    }
  }
}
