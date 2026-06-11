// Scheduler scan — finds every active report_schedule whose nextRunAt is due
// (or null), enqueues a run, and rolls nextRunAt forward.
//
// Invoke from the scheduled tick handler (cron `*/5 * * * *`). Idempotent:
// rerunning before the next cadence boundary advances does nothing because
// nextRunAt was already moved forward.

import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { db, withSuperAdmin } from '@beaconhs/db'
import { reportSchedules } from '@beaconhs/db/schema'
import { enqueueReportRun } from '@beaconhs/jobs'

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

// --- Cadence helper (duplicated from apps/web/src/lib/report-cadence.ts) -
// We keep this in-package so the worker doesn't reach into the web app.
// Keep both files in sync when changing the algorithm.

export type Cadence = 'daily' | 'weekly' | 'monthly'

export type CadenceInput = {
  cadence: Cadence
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  hour: number
  minute: number
  timezone: string
}

export function computeNextRunAt(input: CadenceInput, from: Date = new Date()): Date {
  const tz = input.timezone || 'UTC'
  const start = startOfTzDay(from, tz)
  for (let i = 0; i < 366; i++) {
    const dayLocal = addDays(start, i)
    if (!matchesDay(dayLocal, input, tz)) continue
    const candidate = zonedDateTimeToUtc(
      tzYear(dayLocal, tz),
      tzMonth(dayLocal, tz),
      tzDay(dayLocal, tz),
      input.hour,
      input.minute,
      tz,
    )
    if (candidate.getTime() > from.getTime()) return candidate
  }
  throw new Error('computeNextRunAt: no match within a year')
}

function matchesDay(localDay: Date, input: CadenceInput, tz: string): boolean {
  if (input.cadence === 'daily') return true
  if (input.cadence === 'weekly') {
    const dow = tzWeekday(localDay, tz)
    return dow === (input.dayOfWeek ?? 1)
  }
  if (input.cadence === 'monthly') {
    return tzDay(localDay, tz) === (input.dayOfMonth ?? 1)
  }
  return false
}

function startOfTzDay(d: Date, tz: string): Date {
  const y = tzYear(d, tz)
  const m = tzMonth(d, tz)
  const day = tzDay(d, tz)
  return zonedDateTimeToUtc(y, m, day, 12, 0, tz)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 3600 * 1000)
}

function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  for (let i = 0; i < 3; i++) {
    const guess = new Date(utcMs)
    const have = tzReadAll(guess, tz)
    const want = { year, month, day, hour, minute }
    const diff =
      (want.year - have.year) * 365 * 24 * 3600 * 1000 +
      ((want.month - have.month) * 30 + (want.day - have.day)) * 24 * 3600 * 1000 +
      (want.hour - have.hour) * 3600 * 1000 +
      (want.minute - have.minute) * 60 * 1000
    if (diff === 0) break
    utcMs += diff
  }
  return new Date(utcMs)
}

function tzReadAll(d: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? '0')
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour') === 24 ? 0 : get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

function tzYear(d: Date, tz: string): number {
  return tzReadAll(d, tz).year
}
function tzMonth(d: Date, tz: string): number {
  return tzReadAll(d, tz).month
}
function tzDay(d: Date, tz: string): number {
  return tzReadAll(d, tz).day
}
function tzWeekday(d: Date, tz: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)
}
