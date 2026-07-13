// Scheduler scan — finds every active report_schedule whose nextRunAt is due
// (or null), enqueues a run, and rolls nextRunAt forward.
//
// Invoke from the scheduled tick handler (cron `*/5 * * * *`). Idempotent:
// rerunning before the next cadence boundary advances does nothing because
// nextRunAt was already moved forward.

import { and, asc, eq, isNull, lte, or } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { reportRuns, reportSchedules } from '@beaconhs/db/schema'
import { enqueueReportRun } from '@beaconhs/jobs'
import { claimReportRun, computeNextRunAt } from '@beaconhs/reports'

export async function scanReportSchedules(now: Date = new Date()): Promise<void> {
  // Claim each occurrence and advance its cursor in ONE database transaction.
  // Redis publication happens afterwards; if it fails, the queued run remains
  // durable and every later scan retries the same deterministic BullMQ job.
  const claimed = await withSuperAdmin(db, async (tx) => {
    const due = await tx
      .select()
      .from(reportSchedules)
      .where(
        and(
          eq(reportSchedules.active, true),
          or(isNull(reportSchedules.nextRunAt), lte(reportSchedules.nextRunAt, now)),
        ),
      )
      .for('update', { skipLocked: true })

    const runs: { id: string; tenantId: string; scheduleId: string }[] = []
    for (const schedule of due) {
      const occurrence = schedule.nextRunAt ?? new Date(Math.floor(now.getTime() / 60_000) * 60_000)
      const run = await claimReportRun(tx, {
        scheduleId: schedule.id,
        scheduledFor: occurrence,
        trigger: 'scheduled',
      })
      const next = computeNextRunAt(
        {
          cadence: schedule.cadence,
          dayOfWeek: schedule.dayOfWeek,
          dayOfMonth: schedule.dayOfMonth,
          hour: schedule.hour,
          minute: schedule.minute,
          timezone: schedule.timezone,
        },
        now,
      )
      await tx
        .update(reportSchedules)
        .set({ nextRunAt: next })
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
  const queued = await withSuperAdmin(db, (tx) =>
    tx
      .select({
        id: reportRuns.id,
        tenantId: reportRuns.tenantId,
        scheduleId: reportRuns.scheduleId,
      })
      .from(reportRuns)
      .where(eq(reportRuns.status, 'queued'))
      .orderBy(asc(reportRuns.createdAt))
      .limit(500),
  )
  const failures: string[] = []
  for (const run of queued) {
    try {
      await enqueueReportRun({ tenantId: run.tenantId, scheduleId: run.scheduleId, runId: run.id })
    } catch (error) {
      failures.push(`${run.id}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`Failed to publish ${failures.length} report run(s): ${failures.join('; ')}`)
  }
  if (queued.length > 0) {
    console.log(`[reports] ensured ${queued.length} queued run(s) are published`)
  }
}
