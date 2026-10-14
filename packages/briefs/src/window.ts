// Reporting windows, resolved in the schedule's timezone. A window is always
// whole local days: [start of first day, start of the day after the last).

import type { BriefWindowSpec } from '@beaconhs/db/schema'

export type ResolvedBriefWindow = {
  start: Date
  end: Date
  /** Inclusive local dates covered, YYYY-MM-DD. */
  firstDay: string
  lastDay: string
  label: string
  timezone: string
}

const DAY_MS = 86_400_000

function parts(instant: Date, timeZone: string) {
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant)
  const get = (type: string) => Number(formatted.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** The local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDate(instant: Date, timeZone: string): string {
  const p = parts(instant, timeZone)
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

/** Offset of `timeZone` from UTC at `instant`, in ms (local − UTC). */
function offsetAt(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000
}

/** The UTC instant of local midnight starting `date` (YYYY-MM-DD) in `timeZone`. */
export function zonedMidnight(date: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const guess = Date.UTC(y, m - 1, d)
  let instant = guess - offsetAt(new Date(guess), timeZone)
  // A second pass settles DST transitions that move the offset across the guess.
  instant = guess - offsetAt(new Date(instant), timeZone)
  return new Date(instant)
}

/** Shift a YYYY-MM-DD date by whole days. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10)
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD date. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

function formatDay(date: string, options: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  )
}

export function windowLabel(firstDay: string, lastDay: string): string {
  if (firstDay === lastDay) {
    return formatDay(firstDay, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  }
  const sameYear = firstDay.slice(0, 4) === lastDay.slice(0, 4)
  const from = formatDay(firstDay, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
  const to = formatDay(lastDay, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  return `${from} – ${to}`
}

function fromDays(firstDay: string, lastDay: string, timeZone: string): ResolvedBriefWindow {
  return {
    start: zonedMidnight(firstDay, timeZone),
    end: zonedMidnight(addDays(lastDay, 1), timeZone),
    firstDay,
    lastDay,
    label: windowLabel(firstDay, lastDay),
    timezone: timeZone,
  }
}

/**
 * Resolve a window relative to `now` (the run's occurrence time).
 * - previous_day: yesterday.
 * - previous_business_day: from the most recent weekday before today through
 *   yesterday — on Monday that is Friday through Sunday, so weekend journals
 *   are covered.
 * - last_n_days: the n days before today.
 * - since_last_run: from the previous run's window end through yesterday;
 *   falls back to yesterday when there is no previous run.
 */
export function resolveBriefWindow(
  spec: BriefWindowSpec,
  now: Date,
  timeZone: string,
  previousWindowEnd: Date | null = null,
): ResolvedBriefWindow {
  const today = localDate(now, timeZone)
  const yesterday = addDays(today, -1)
  switch (spec.mode) {
    case 'previous_day':
      return fromDays(yesterday, yesterday, timeZone)
    case 'previous_business_day': {
      let first = yesterday
      while (weekday(first) === 0 || weekday(first) === 6) first = addDays(first, -1)
      return fromDays(first, yesterday, timeZone)
    }
    case 'last_n_days':
      return fromDays(addDays(today, -spec.days), yesterday, timeZone)
    case 'since_last_run': {
      if (!previousWindowEnd) return fromDays(yesterday, yesterday, timeZone)
      const first = localDate(previousWindowEnd, timeZone)
      return first > yesterday
        ? fromDays(yesterday, yesterday, timeZone)
        : fromDays(first, yesterday, timeZone)
    }
  }
}

/** An explicit inclusive local-date range (studio preview, API). */
export function explicitBriefWindow(
  firstDay: string,
  lastDay: string,
  timeZone: string,
): ResolvedBriefWindow {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstDay) || !/^\d{4}-\d{2}-\d{2}$/.test(lastDay)) {
    throw new Error('Window dates must be YYYY-MM-DD')
  }
  if (firstDay > lastDay) throw new Error('The window must start on or before its last day')
  const span =
    (zonedMidnight(lastDay, 'UTC').getTime() - zonedMidnight(firstDay, 'UTC').getTime()) / DAY_MS
  if (span > 92) throw new Error('A brief window can cover at most 93 days')
  return fromDays(firstDay, lastDay, timeZone)
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date())
    return true
  } catch {
    return false
  }
}
