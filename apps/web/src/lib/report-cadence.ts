// Helpers for computing the next-run timestamp of a scheduled report.
//
// We work in the schedule's local timezone (IANA, e.g. 'America/Toronto'),
// pin the hour/minute, and roll forward to the next matching day-of-week (for
// weekly) or day-of-month (for monthly). Daily simply rolls forward by 24h.
//
// We use Intl.DateTimeFormat with the target timezone to read out the
// schedule's local Y/M/D/h/m/dow, then construct UTC instants by binary-
// searching the timezone offset (a 3-step iteration nails sub-second
// accuracy for any non-pathological zone).

export type Cadence = 'daily' | 'weekly' | 'monthly'

export type CadenceInput = {
  cadence: Cadence
  /** 0 = Sunday … 6 = Saturday. Required for weekly. */
  dayOfWeek?: number | null
  /** 1..31. Required for monthly. */
  dayOfMonth?: number | null
  hour: number
  minute: number
  /** IANA zone (e.g. 'America/Toronto'). */
  timezone: string
}

/**
 * Returns the next future UTC Date matching the cadence (strictly > `from`).
 */
export function computeNextRunAt(input: CadenceInput, from: Date = new Date()): Date {
  const tz = input.timezone || 'UTC'
  // Probe candidate days starting from `from` (in tz). For weekly/monthly we
  // may need to walk forward up to ~60 days; 366 is a safe upper bound for
  // edge cases like Feb-29 monthly schedules.
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
  // Shouldn't happen for any realistic schedule.
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

// --- Timezone arithmetic -------------------------------------------------

/** A near-noon UTC Date for the day-in-tz that `d` falls on. */
function startOfTzDay(d: Date, tz: string): Date {
  // Build a noon-in-tz to avoid DST shoulders.
  const y = tzYear(d, tz)
  const m = tzMonth(d, tz)
  const day = tzDay(d, tz)
  return zonedDateTimeToUtc(y, m, day, 12, 0, tz)
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 3600 * 1000)
}

/**
 * Construct a UTC Date that, when formatted in tz, reads Y-M-D h:m:00.
 * We iterate: pick a guess, format it back, adjust by the difference.
 */
function zonedDateTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): Date {
  // Initial guess: treat the local components as UTC, then offset.
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  // Iterate up to 3 times — DST shifts converge fast.
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
