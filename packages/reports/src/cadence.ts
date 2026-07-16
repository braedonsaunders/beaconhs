// Next-run computation for scheduled reports — THE single copy (previously
// duplicated verbatim in apps/web/src/lib/report-cadence.ts and
// apps/worker/src/lib/report-scheduler.ts with a keep-in-sync comment).
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
  /** Monthly nth-weekday mode: 1..4 = ordinal, 5 = last. */
  weekOfMonth?: number | null
  /** Repeat every N cadence periods. */
  repeatEvery?: number | null
  hour: number
  minute: number
  /** IANA zone (e.g. 'America/Toronto'). */
  timezone: string
  /** Inclusive local-date bounds (YYYY-MM-DD). */
  startsOn?: string | null
  endsOn?: string | null
}

/**
 * Returns the next future UTC Date matching the cadence (strictly > `from`).
 */
export function computeNextRunAt(input: CadenceInput, from: Date = new Date()): Date | null {
  const tz = input.timezone || 'UTC'
  const repeatEvery = input.repeatEvery ?? 1
  if (!Number.isSafeInteger(repeatEvery) || repeatEvery < 1 || repeatEvery > 999) {
    throw new Error('repeatEvery must be an integer between 1 and 999')
  }
  validateDateBound(input.startsOn, 'startsOn')
  validateDateBound(input.endsOn, 'endsOn')
  if (input.startsOn && input.endsOn && input.startsOn > input.endsOn) {
    throw new Error('startsOn must be on or before endsOn')
  }

  // Probe local calendar days. Ten years covers the largest accepted interval
  // while still terminating quickly for an ended schedule.
  const start = startOfTzDay(from, tz)
  for (let i = 0; i < 3660; i++) {
    const dayLocal = addDays(start, i)
    const dateKey = tzDateKey(dayLocal, tz)
    if (input.startsOn && dateKey < input.startsOn) continue
    if (input.endsOn && dateKey > input.endsOn) return null
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
  throw new Error('computeNextRunAt: no match within ten years')
}

function matchesDay(localDay: Date, input: CadenceInput, tz: string): boolean {
  const repeatEvery = input.repeatEvery ?? 1
  const dateKey = tzDateKey(localDay, tz)
  const anchorKey = input.startsOn ?? '1970-01-04'
  const anchor = parseDateKey(anchorKey)
  const current = {
    year: tzYear(localDay, tz),
    month: tzMonth(localDay, tz),
    day: tzDay(localDay, tz),
  }
  const daysFromAnchor = calendarDayNumber(current) - calendarDayNumber(anchor)
  if (daysFromAnchor < 0) return false

  if (input.cadence === 'daily') return daysFromAnchor % repeatEvery === 0
  if (input.cadence === 'weekly') {
    const dow = tzWeekday(localDay, tz)
    return dow === (input.dayOfWeek ?? 1) && Math.floor(daysFromAnchor / 7) % repeatEvery === 0
  }
  if (input.cadence === 'monthly') {
    const monthsFromAnchor = (current.year - anchor.year) * 12 + (current.month - anchor.month)
    if (monthsFromAnchor < 0 || monthsFromAnchor % repeatEvery !== 0) return false
    if (input.weekOfMonth != null) {
      const expectedDow = input.dayOfWeek ?? 1
      if (tzWeekday(localDay, tz) !== expectedDow) return false
      if (input.weekOfMonth === 5) {
        return current.day + 7 > daysInMonth(current.year, current.month)
      }
      return Math.ceil(current.day / 7) === input.weekOfMonth
    }
    return current.day === (input.dayOfMonth ?? 1)
  }
  return false
}

function validateDateBound(value: string | null | undefined, label: string): void {
  if (!value) return
  const parsed = parseDateKey(value)
  if (
    tzDateKey(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12)), 'UTC') !== value
  ) {
    throw new Error(`${label} must be a valid YYYY-MM-DD date`)
  }
}

function parseDateKey(value: string): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) throw new Error('Schedule date bounds must use YYYY-MM-DD')
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function calendarDayNumber(value: { year: number; month: number; day: number }): number {
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / 86_400_000)
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
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
 */
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

function tzDateKey(d: Date, tz: string): string {
  return `${String(tzYear(d, tz)).padStart(4, '0')}-${String(tzMonth(d, tz)).padStart(2, '0')}-${String(tzDay(d, tz)).padStart(2, '0')}`
}
