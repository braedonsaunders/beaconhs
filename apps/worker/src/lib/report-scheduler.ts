// Scheduler scan — finds every active report_schedule whose nextRunAt is due
// (or null), enqueues a run, and rolls nextRunAt forward.
//
// Invoke from the scheduled tick handler (cron `*/5 * * * *`). Idempotent:
// rerunning before the next cadence boundary advances does nothing because
// nextRunAt was already moved forward.

import { and, eq, isNull, lte, or } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { reportSchedules } from '@beaconhs/db/schema'
import { enqueueReportRun } from '@beaconhs/jobs'
import { computeNextRunAt } from '@beaconhs/reports'

// Re-export so existing consumers (e.g. _cadence-test.ts) keep working.
export { computeNextRunAt, type Cadence, type CadenceInput } from '@beaconhs/reports'

export async function scanReportSchedules(now: Date = new Date()): Promise<void> {
  const due = await withSuperAdmin(db, async (tx) => {
    return tx
      .select()
      .from(reportSchedules)
      .where(
        and(
          eq(reportSchedules.active, true),
          or(isNull(reportSchedules.nextRunAt), lte(reportSchedules.nextRunAt, now)),
        ),
      )
  })

  if (!due.length) {
    return
  }
  console.log(`[reports] enqueuing ${due.length} due schedule(s)`)

  for (const s of due) {
    const next = computeNextRunAt(
      {
        cadence: s.cadence,
        dayOfWeek: s.dayOfWeek,
        dayOfMonth: s.dayOfMonth,
        hour: s.hour,
        minute: s.minute,
        timezone: s.timezone,
      },
      now,
    )

    // Roll forward first, then enqueue. If the enqueue fails the next tick
    // will pick the schedule up again at its newly-set nextRunAt — fine,
    // because the worker is idempotent at the schedule-id grain (runs are
    // separate rows).
    await withSuperAdmin(db, async (tx) => {
      await tx.update(reportSchedules).set({ nextRunAt: next }).where(eq(reportSchedules.id, s.id))
    })

    try {
      await enqueueReportRun({ tenantId: s.tenantId, scheduleId: s.id })
      console.log(`[reports] enqueued schedule ${s.id} (next=${next.toISOString()})`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[reports] failed to enqueue schedule ${s.id}: ${msg}`)
    }
  }
}
