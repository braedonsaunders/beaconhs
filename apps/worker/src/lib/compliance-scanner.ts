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

import { and, asc, eq, exists, inArray, isNull, notExists, sql } from 'drizzle-orm'
import { db, withSuperAdmin, withTenant, type Database } from '@beaconhs/db'
import {
  complianceDispatches,
  complianceObligations,
  tenantNotificationPolicy,
  tenants,
} from '@beaconhs/db/schema'
import { materializeTenant } from '@beaconhs/compliance'
import { emitComplianceTransitions } from '@beaconhs/events'
import {
  publishQueuedEquipmentMaintenance,
  scanTenantEquipmentMaintenance,
} from './equipment-maintenance-scanner'
import { cronOccursAt } from './cron'
import { formComplianceBoundaryDue } from './form-compliance-schedule'
import {
  durablePublicationClaimPredicate,
  durablePublicationError,
  durablePublicationRetryAt,
  DURABLE_PUBLICATION_BATCH_SIZE,
} from './durable-publication-policy'

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
  return cronOccursAt(cron, now, tz || 'UTC')
}

function complianceErrorMessage(error: unknown): string {
  return durablePublicationError(error, 'Compliance scan failed')
}

function liveObligationForDispatch(tx: Database) {
  return tx
    .select({ id: complianceObligations.id })
    .from(complianceObligations)
    .where(
      and(
        eq(complianceObligations.tenantId, complianceDispatches.tenantId),
        eq(complianceObligations.id, complianceDispatches.obligationId),
        eq(complianceObligations.status, 'active'),
        isNull(complianceObligations.deletedAt),
      ),
    )
}

/**
 * A paused/deleted obligation invalidates every unpublished alert, including a
 * lease abandoned by another worker. Clearing the lease makes the skipped row
 * terminal and prevents a stale claimant from acknowledging it afterward.
 */
async function skipInactiveQueuedComplianceDispatches(tx: Database): Promise<void> {
  await tx
    .update(complianceDispatches)
    .set({
      status: 'skipped',
      error: 'Compliance obligation is no longer active',
      publishLeaseId: null,
      publishClaimedAt: null,
    })
    .where(and(eq(complianceDispatches.status, 'queued'), notExists(liveObligationForDispatch(tx))))
}

async function claimQueuedComplianceDispatches(tx: Database, now: Date) {
  await skipInactiveQueuedComplianceDispatches(tx)
  const candidates = await tx
    .select({ id: complianceDispatches.id })
    .from(complianceDispatches)
    .where(
      and(
        durablePublicationClaimPredicate(
          {
            status: complianceDispatches.status,
            availableAt: complianceDispatches.publishAvailableAt,
            leaseId: complianceDispatches.publishLeaseId,
            claimedAt: complianceDispatches.publishClaimedAt,
          },
          now,
        ),
        exists(liveObligationForDispatch(tx)),
      ),
    )
    .orderBy(
      asc(complianceDispatches.publishAvailableAt),
      asc(complianceDispatches.createdAt),
      asc(complianceDispatches.id),
    )
    .limit(DURABLE_PUBLICATION_BATCH_SIZE)
    .for('update', { skipLocked: true })
  if (candidates.length === 0) return []

  const claimed = await tx
    .update(complianceDispatches)
    .set({
      publishLeaseId: sql`gen_random_uuid()`,
      publishClaimedAt: now,
      publishAttempts: sql`${complianceDispatches.publishAttempts} + 1`,
      error: null,
    })
    .where(
      and(
        eq(complianceDispatches.status, 'queued'),
        inArray(
          complianceDispatches.id,
          candidates.map(({ id }) => id),
        ),
      ),
    )
    .returning()
  return claimed.map((dispatch) => {
    if (!dispatch.publishLeaseId) {
      throw new Error(`Compliance dispatch ${dispatch.id} was locked but could not be leased`)
    }
    return { ...dispatch, publishLeaseId: dispatch.publishLeaseId }
  })
}

export async function confirmDispatchStillPublishable(
  tx: Database,
  dispatchId: string,
  leaseId: string,
  tenantId: string,
  obligationId: string,
): Promise<boolean> {
  // Shared lock order is obligation first, dispatch second. Materialization
  // uses the same order, avoiding the status/outbox ↔ obligation inversion
  // that previously made a concurrent scan and pause susceptible to deadlock.
  const [obligation] = await tx
    .select({
      id: complianceObligations.id,
      status: complianceObligations.status,
      deletedAt: complianceObligations.deletedAt,
    })
    .from(complianceObligations)
    .where(
      and(eq(complianceObligations.tenantId, tenantId), eq(complianceObligations.id, obligationId)),
    )
    .limit(1)
    .for('key share')

  if (!obligation || obligation.status !== 'active' || obligation.deletedAt) {
    await tx
      .update(complianceDispatches)
      .set({
        status: 'skipped',
        error: 'Compliance obligation is no longer active',
        publishLeaseId: null,
        publishClaimedAt: null,
      })
      .where(
        and(
          eq(complianceDispatches.id, dispatchId),
          eq(complianceDispatches.status, 'queued'),
          eq(complianceDispatches.publishLeaseId, leaseId),
        ),
      )
    return false
  }

  const [owned] = await tx
    .update(complianceDispatches)
    .set({ publishClaimedAt: new Date() })
    .where(
      and(
        eq(complianceDispatches.id, dispatchId),
        eq(complianceDispatches.status, 'queued'),
        eq(complianceDispatches.publishLeaseId, leaseId),
      ),
    )
    .returning({ id: complianceDispatches.id })
  return Boolean(owned)
}

type ClaimedComplianceDispatch = Pick<
  typeof complianceDispatches.$inferSelect,
  'id' | 'tenantId' | 'obligationId' | 'alertPayload'
> & { publishLeaseId: string }

type CompliancePublicationOutcome = 'enqueued' | 'skipped' | 'failed'

/**
 * Publish while the caller's transaction retains the obligation and dispatch
 * locks acquired by `confirmDispatchStillPublishable`. Queue job IDs are
 * deterministic, so a transaction rollback after a partial Redis write is
 * safely retried without duplicating a notification or email.
 */
export async function publishClaimedComplianceDispatch(
  tx: Database,
  dispatch: ClaimedComplianceDispatch,
  emit: typeof emitComplianceTransitions = emitComplianceTransitions,
): Promise<CompliancePublicationOutcome> {
  const owned = await confirmDispatchStillPublishable(
    tx,
    dispatch.id,
    dispatch.publishLeaseId,
    dispatch.tenantId,
    dispatch.obligationId,
  )
  if (!owned) return 'skipped'

  const transitions = dispatch.alertPayload?.transitions
  if (!transitions?.length) {
    await tx
      .update(complianceDispatches)
      .set({
        status: 'failed',
        error: 'Queued compliance dispatch has no alert payload',
        publishLeaseId: null,
        publishClaimedAt: null,
      })
      .where(
        and(
          eq(complianceDispatches.id, dispatch.id),
          eq(complianceDispatches.status, 'queued'),
          eq(complianceDispatches.publishLeaseId, dispatch.publishLeaseId),
        ),
      )
    return 'failed'
  }

  const emitted = await emit(
    dispatch.tenantId,
    dispatch.obligationId,
    transitions,
    dispatch.id,
    dispatch.publishLeaseId,
    tx,
  )
  await tx
    .update(complianceDispatches)
    .set({
      status: emitted ? 'enqueued' : 'skipped',
      error: emitted ? null : 'Compliance dispatch no longer applies to the active obligation',
      publishLeaseId: null,
      publishClaimedAt: null,
    })
    .where(
      and(
        eq(complianceDispatches.id, dispatch.id),
        eq(complianceDispatches.status, 'queued'),
        eq(complianceDispatches.publishLeaseId, dispatch.publishLeaseId),
      ),
    )
  return emitted ? 'enqueued' : 'skipped'
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
  const { tenantRows, formSchedules } = await withSuperAdmin(db, async (tx) => {
    const tenantRows = await tx
      .select({
        id: tenants.id,
        enabled: tenantNotificationPolicy.scanEnabled,
        cron: tenantNotificationPolicy.scanCron,
        tz: tenantNotificationPolicy.scanTimezone,
      })
      .from(tenants)
      .leftJoin(tenantNotificationPolicy, eq(tenantNotificationPolicy.tenantId, tenants.id))
    const formSchedules = await tx
      .select({
        id: complianceObligations.id,
        tenantId: complianceObligations.tenantId,
        recurrence: complianceObligations.recurrence,
      })
      .from(complianceObligations)
      .where(
        and(
          eq(complianceObligations.sourceModule, 'form'),
          eq(complianceObligations.status, 'active'),
          isNull(complianceObligations.deletedAt),
        ),
      )
    return { tenantRows, formSchedules }
  })
  const formSchedulesByTenant = new Map<string, typeof formSchedules>()
  for (const schedule of formSchedules) {
    const list = formSchedulesByTenant.get(schedule.tenantId) ?? []
    list.push(schedule)
    formSchedulesByTenant.set(schedule.tenantId, list)
  }
  const schedules = tenantRows.map((r) => ({
    id: r.id,
    // A missing policy row (left join null) keeps the documented default-on
    // behaviour; an explicit `false` pauses the scan for this tenant.
    enabled: r.enabled ?? true,
    cron: r.cron ?? DEFAULT_CRON,
    tz: r.tz ?? DEFAULT_TZ,
  }))

  for (const s of schedules) {
    result.tenants += 1
    // Detection paused for this tenant: no materialization, reminders, or
    // equipment-maintenance alerts until an admin turns it back on.
    if (!s.enabled) continue
    let tenantHeartbeatDue: boolean
    try {
      tenantHeartbeatDue = cronDueNow(s.cron, s.tz, now)
    } catch (error) {
      result.errors += 1
      console.warn(
        `[compliance_scan] tenant ${s.id} has an invalid scan schedule: ${complianceErrorMessage(error)}`,
      )
      continue
    }
    let formBoundaryDue = false
    for (const schedule of formSchedulesByTenant.get(s.id) ?? []) {
      try {
        if (formComplianceBoundaryDue(schedule.recurrence, now, s.tz)) formBoundaryDue = true
      } catch (error) {
        // One damaged imported obligation must not suppress every other
        // compliance status (or equipment maintenance) for this tenant.
        result.errors += 1
        console.warn(
          `[compliance_scan] form obligation ${schedule.id} has an invalid schedule: ${complianceErrorMessage(error)}`,
        )
      }
    }
    if (!tenantHeartbeatDue && !formBoundaryDue) continue
    result.due += 1

    let materialized: Awaited<ReturnType<typeof materializeTenant>> = []
    try {
      // Per-tenant RLS context so reads + the compliance_status upsert are scoped.
      materialized = await withTenant(db, s.id, async (tx) => {
        const rows = await materializeTenant(tx, s.id, { now, timezone: s.tz })
        result.reminders += rows.filter((row) => row.dispatchId !== null).length
        return rows
      })
    } catch (err) {
      result.errors += 1
      console.warn(`[compliance_scan] tenant ${s.id} failed: ${complianceErrorMessage(err)}`)
      continue
    }
    result.obligations += materialized.length
    // Equipment maintenance rides the same per-tenant heartbeat — inspection
    // schedules + ad-hoc reminders whose due date arrived alert once per due
    // cycle (see the scanner's due_notified_for stamps).
    if (tenantHeartbeatDue) {
      try {
        result.maintenance += await scanTenantEquipmentMaintenance(s.id)
      } catch (err) {
        result.errors += 1
        console.warn(
          `[compliance_scan] equipment maintenance for tenant ${s.id} failed: ${complianceErrorMessage(err)}`,
        )
      }
    }
  }
  await publishQueuedComplianceDispatches(result)
  const maintenanceDelivery = await publishQueuedEquipmentMaintenance()
  result.errors += maintenanceDelivery.errors
  return result
}

async function publishQueuedComplianceDispatches(result: ComplianceScanResult): Promise<void> {
  const queued = await withSuperAdmin(db, (tx) => claimQueuedComplianceDispatches(tx, new Date()))
  for (const dispatch of queued) {
    try {
      const outcome = await withSuperAdmin(db, async (tx) => {
        // Keep the obligation KEY SHARE lock and the leased dispatch row lock
        // acquired by the helper until every idempotent queue write and the
        // terminal update complete. A concurrent evidence/semantic writer
        // takes the obligation UPDATE lock first, so publication linearizes
        // entirely before that new truth or entirely after it.
        return publishClaimedComplianceDispatch(tx, dispatch)
      })
      if (outcome === 'failed') result.errors += 1
    } catch (error) {
      result.errors += 1
      const failedAt = new Date()
      await withSuperAdmin(db, (tx) =>
        tx
          .update(complianceDispatches)
          .set({
            error: durablePublicationError(error, 'Compliance dispatch failed'),
            publishAvailableAt: durablePublicationRetryAt(dispatch.publishAttempts, failedAt),
            publishLeaseId: null,
            publishClaimedAt: null,
          })
          .where(
            and(
              eq(complianceDispatches.id, dispatch.id),
              eq(complianceDispatches.status, 'queued'),
              eq(complianceDispatches.publishLeaseId, dispatch.publishLeaseId),
            ),
          ),
      )
    }
  }
}
