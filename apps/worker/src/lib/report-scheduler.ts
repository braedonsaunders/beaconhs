// Scheduler scan — finds every active report_schedule whose nextRunAt is due
// (or null), enqueues a run, and rolls nextRunAt forward.
//
// Invoke from the scheduled tick handler (cron `*/5 * * * *`). Idempotent:
// rerunning before the next cadence boundary advances does nothing because
// nextRunAt was already moved forward.

import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { db, withSuperAdmin, type Database } from '@beaconhs/db'
import { reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { enqueueReportRun } from '@beaconhs/jobs'
import { computeNextRunAt } from '@beaconhs/reports'
import { claimBeaconReportRun } from '@beaconhs/reports/server'
import {
  durablePublicationClaimPredicate,
  durablePublicationError,
  durablePublicationRepublishAt,
  durablePublicationRetryAt,
  DURABLE_PUBLICATION_BATCH_SIZE,
} from './durable-publication-policy'

async function claimQueuedReportRuns(tx: Database, now: Date) {
  const candidates = await tx
    .select({ id: reportRuns.id })
    .from(reportRuns)
    .where(
      durablePublicationClaimPredicate(
        {
          status: reportRuns.status,
          availableAt: reportRuns.publishAvailableAt,
          leaseId: reportRuns.publishLeaseId,
          claimedAt: reportRuns.publishClaimedAt,
        },
        now,
      ),
    )
    .orderBy(asc(reportRuns.publishAvailableAt), asc(reportRuns.createdAt), asc(reportRuns.id))
    .limit(DURABLE_PUBLICATION_BATCH_SIZE)
    .for('update', { skipLocked: true })
  if (candidates.length === 0) return []

  const claimed = await tx
    .update(reportRuns)
    .set({
      publishLeaseId: sql`gen_random_uuid()`,
      publishClaimedAt: now,
      publishAttempts: sql`${reportRuns.publishAttempts} + 1`,
      error: null,
    })
    .where(
      and(
        eq(reportRuns.status, 'queued'),
        inArray(
          reportRuns.id,
          candidates.map(({ id }) => id),
        ),
      ),
    )
    .returning({
      id: reportRuns.id,
      tenantId: reportRuns.tenantId,
      scheduleId: reportRuns.scheduleId,
      publishAttempts: reportRuns.publishAttempts,
      publishLeaseId: reportRuns.publishLeaseId,
    })
  return claimed.map((run) => {
    if (!run.publishLeaseId) {
      throw new Error(`Report run ${run.id} was locked but could not be leased`)
    }
    return { ...run, publishLeaseId: run.publishLeaseId }
  })
}

export async function scanReportSchedules(now: Date = new Date()): Promise<void> {
  // Claim each occurrence and advance its cursor in ONE database transaction.
  // Redis publication happens afterwards; if it fails, the queued run remains
  // durable and every later scan retries the same deterministic BullMQ job.
  const claimed = await withSuperAdmin(db, async (tx) => {
    const due = await tx
      .select()
      .from(reportSchedules)
      .where(and(eq(reportSchedules.active, true), lte(reportSchedules.nextRunAt, now)))
      .orderBy(sql`${reportSchedules.nextRunAt} ASC NULLS FIRST`, asc(reportSchedules.id))
      .limit(100)
      .for('update', { skipLocked: true })

    const runs: { id: string; tenantId: string; scheduleId: string }[] = []
    for (const schedule of due) {
      const occurrence = schedule.nextRunAt ?? new Date(Math.floor(now.getTime() / 60_000) * 60_000)
      const run = await claimBeaconReportRun(tx, {
        scheduleId: schedule.id,
        scheduledFor: occurrence,
        trigger: 'scheduled',
      })
      const next = computeNextRunAt(
        {
          cadence: schedule.cadence,
          repeatEvery: schedule.repeatEvery,
          dayOfWeek: schedule.dayOfWeek,
          dayOfMonth: schedule.dayOfMonth,
          weekOfMonth: schedule.weekOfMonth,
          hour: schedule.hour,
          minute: schedule.minute,
          timezone: schedule.timezone,
          startsOn: schedule.startsOn,
          endsOn: schedule.endsOn,
        },
        now,
      )
      await tx
        .update(reportSchedules)
        .set({ nextRunAt: next, ...(next ? {} : { active: false }) })
        .where(eq(reportSchedules.id, schedule.id))
      runs.push({ id: run.id, tenantId: schedule.tenantId, scheduleId: schedule.id })
    }
    return runs
  })

  if (claimed.length > 0) {
    console.log(`[reports] claimed ${claimed.length} due schedule(s)`)
  }

  // Recovery is intentionally independent of active schedules. Manual runs and
  // a run claimed just before Redis went down are both represented by queued
  // ledger rows and must be published once Redis returns.
  const queued = await withSuperAdmin(db, (tx) => claimQueuedReportRuns(tx, new Date()))
  let failureCount = 0
  const failedRunIds: string[] = []
  for (const run of queued) {
    const [owned] = await withSuperAdmin(db, (tx) =>
      tx
        .update(reportRuns)
        .set({ publishClaimedAt: new Date() })
        .where(
          and(
            eq(reportRuns.id, run.id),
            eq(reportRuns.status, 'queued'),
            eq(reportRuns.publishLeaseId, run.publishLeaseId),
          ),
        )
        .returning({ id: reportRuns.id }),
    )
    if (!owned) continue

    try {
      await enqueueReportRun({ tenantId: run.tenantId, scheduleId: run.scheduleId, runId: run.id })
      await withSuperAdmin(db, (tx) =>
        tx
          .update(reportRuns)
          .set({
            publishAvailableAt: durablePublicationRepublishAt(new Date()),
            publishLeaseId: null,
            publishClaimedAt: null,
            error: null,
          })
          .where(
            and(
              eq(reportRuns.id, run.id),
              eq(reportRuns.status, 'queued'),
              eq(reportRuns.publishLeaseId, run.publishLeaseId),
            ),
          ),
      )
    } catch (error) {
      failureCount += 1
      if (failedRunIds.length < 10) failedRunIds.push(run.id)
      const failedAt = new Date()
      await withSuperAdmin(db, (tx) =>
        tx
          .update(reportRuns)
          .set({
            publishAvailableAt: durablePublicationRetryAt(run.publishAttempts, failedAt),
            publishLeaseId: null,
            publishClaimedAt: null,
            error: durablePublicationError(error, 'Report run publication failed'),
          })
          .where(
            and(
              eq(reportRuns.id, run.id),
              eq(reportRuns.status, 'queued'),
              eq(reportRuns.publishLeaseId, run.publishLeaseId),
            ),
          ),
      )
    }
  }
  if (failureCount > 0) {
    throw new Error(
      `Failed to publish ${failureCount} report run(s); sample run ids: ${failedRunIds.join(', ')}`,
    )
  }
  if (queued.length > 0) {
    console.log(`[reports] claimed ${queued.length} queued run publication(s)`)
  }
}
