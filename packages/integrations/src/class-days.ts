// The single source of truth for which calendar days a training class runs on
// and how many paid hours each of those days credits.
//
// Rules (product decisions, do not re-derive elsewhere):
//   - Class days are WEEKDAYS (Monday–Friday) only. Weekends never count.
//   - Days are calendar days in the tenant's timezone, never UTC days: an
//     evening class in Toronto is already the next UTC day.
//   - `lengthDays` is authoritative when set: the class occupies that many
//     weekdays starting at (or after) its start date. When it is null, the
//     length is derived by counting the weekdays spanned by startsAt..endsAt.
//   - Credited hours are PAID hours per day (`hoursPerDay`), defaulting to 8 —
//     never the raw clock span between start and end (which includes lunch).
//
// Consumers: class completion credit, the class calendar, weekly timesheet
// export rows, and credential issuance dates. Keep every day/hours derivation
// routed through here so those surfaces can never disagree.

export const DEFAULT_CREDITED_HOURS_PER_DAY = 8

/** Sanity ceiling so a corrupt length can never spin the expansion loop. */
export const MAX_CLASS_LENGTH_DAYS = 366

const DAY_MS = 86_400_000

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS)
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Monday–Friday for a UTC-midnight-anchored calendar date. */
function isWeekday(d: Date): boolean {
  const dow = d.getUTCDay()
  return dow >= 1 && dow <= 5
}

/**
 * The calendar date `instant` falls on in `timeZone`, anchored to UTC
 * midnight so DST can never skew later arithmetic. An unknown zone falls
 * back to UTC rather than throwing inside a delivery.
 */
export function calendarDateInTimeZone(instant: Date, timeZone: string | undefined): Date {
  let zone = timeZone?.trim() || 'UTC'
  try {
    // Throws RangeError for an unknown IANA zone.
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    zone = 'UTC'
  }
  const parts: Record<string, string> = {}
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)) {
    parts[p.type] = p.value
  }
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)))
}

/**
 * Weekdays spanned by startsAt..endsAt (inclusive) in `timeZone` — the length
 * a class gets when nobody set one explicitly. Never less than 1: a class
 * entered over a weekend only still happened once.
 */
export function deriveClassLengthDays(startsAt: Date, endsAt: Date, timeZone?: string): number {
  const start = calendarDateInTimeZone(startsAt, timeZone)
  const end = calendarDateInTimeZone(endsAt, timeZone)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 1
  let count = 0
  for (let day = start; day <= end; day = addDays(day, 1)) {
    if (isWeekday(day)) count += 1
    if (count >= MAX_CLASS_LENGTH_DAYS) break
  }
  return Math.max(1, count)
}

export type ClassDaysInput = {
  startsAt: Date
  endsAt: Date
  lengthDays: number | null | undefined
  timeZone?: string
}

/**
 * Expand a class into the `YYYY-MM-DD` (tenant-timezone) days it runs on.
 * With an explicit `lengthDays`, that many weekdays are collected starting at
 * the start date (a weekend start rolls forward to Monday). Without one, the
 * weekdays inside startsAt..endsAt are used; a weekend-only span keeps its
 * start date so the class still shows and credits once.
 */
export function expandClassDays(input: ClassDaysInput): string[] {
  const start = calendarDateInTimeZone(input.startsAt, input.timeZone)
  if (Number.isNaN(start.getTime())) return []

  const explicit =
    input.lengthDays != null && Number.isFinite(input.lengthDays) && input.lengthDays > 0
      ? Math.min(Math.floor(input.lengthDays), MAX_CLASS_LENGTH_DAYS)
      : null

  if (explicit != null) {
    const days: string[] = []
    // At most ~7/5 calendar days per class day, plus slack for the roll-forward.
    for (let day = start, guard = 0; days.length < explicit && guard < explicit * 2 + 14; guard++) {
      if (isWeekday(day)) days.push(ymd(day))
      day = addDays(day, 1)
    }
    return days
  }

  const end = calendarDateInTimeZone(input.endsAt, input.timeZone)
  if (Number.isNaN(end.getTime()) || end < start) return [ymd(start)]
  const days: string[] = []
  for (let day = start; day <= end && days.length < MAX_CLASS_LENGTH_DAYS; day = addDays(day, 1)) {
    if (isWeekday(day)) days.push(ymd(day))
  }
  return days.length > 0 ? days : [ymd(start)]
}

export type ClassCredit = {
  /** Tenant-timezone `YYYY-MM-DD` class days. */
  days: string[]
  lengthDays: number
  hoursPerDay: number
  totalHours: number
}

/** Resolve the credited schedule for a class: its days and paid hours. */
export function resolveClassCredit(
  input: ClassDaysInput & { hoursPerDay: number | null | undefined },
): ClassCredit {
  const days = expandClassDays(input)
  const hoursPerDay =
    input.hoursPerDay != null && Number.isFinite(input.hoursPerDay) && input.hoursPerDay > 0
      ? input.hoursPerDay
      : DEFAULT_CREDITED_HOURS_PER_DAY
  return {
    days,
    lengthDays: Math.max(1, days.length),
    hoursPerDay,
    totalHours: hoursPerDay * Math.max(1, days.length),
  }
}
