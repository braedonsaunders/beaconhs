// Timezone-aware datetime helpers for server components/actions.
//
// Server components render on the deploy container's clock (UTC in prod), so any
// wall-clock display or `<input type="datetime-local">` round-trip must be
// pinned to the viewer's IANA timezone (`ctx.timezone` on RequestContext):
// format the stored instant into the user's wall-clock for display, and parse a
// posted wall-clock string back into an instant in that same zone. Never render
// a stored instant with a naked `toLocaleString()` in a server component — that
// silently uses UTC and shows times hours off for the viewer.

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(at)) parts[p.type] = p.value
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

type WallClockParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallClockParts(timeZone: string, at: Date): WallClockParts {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
  const parts: Record<string, string> = {}
  for (const part of dtf.formatToParts(at)) parts[part.type] = part.value
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  }
}

/**
 * Format an instant as a `<input type="datetime-local">` value (`YYYY-MM-DDTHH:mm`)
 * in the given IANA timezone.
 */
export function datetimeLocalValue(d: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts: Record<string, string> = {}
  for (const p of dtf.formatToParts(d)) parts[p.type] = p.value
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

/** Format an instant as an ISO calendar date in the given IANA timezone. */
export function dateIsoInTimeZone(d: Date, timeZone: string): string {
  const parts = wallClockParts(timeZone, d)
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/**
 * Parse a wall-clock string (`YYYY-MM-DD[THH:mm[:ss[.sss]]]`) as a time in the
 * given IANA timezone. Strings carrying an explicit offset/Z fall through to
 * native parsing. Returns null when the value is not a valid date/time.
 */
export function parseDatetimeLocal(value: string, timeZone: string): Date | null {
  const s = value.trim()
  if (!s) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(s)
  if (!m) {
    // ISO with explicit offset (e.g. `...Z` / `...-05:00`) — zone-independent.
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const requested = {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
    hour: Number(m[4] ?? 0),
    minute: Number(m[5] ?? 0),
    second: Number(m[6] ?? 0),
    millisecond: Number((m[7] ?? '').padEnd(3, '0') || 0),
  }
  const utcGuess = Date.UTC(
    requested.year,
    requested.month - 1,
    requested.day,
    requested.hour,
    requested.minute,
    requested.second,
    requested.millisecond,
  )
  if (Number.isNaN(utcGuess)) return null
  const normalized = new Date(utcGuess)
  if (
    normalized.getUTCFullYear() !== requested.year ||
    normalized.getUTCMonth() + 1 !== requested.month ||
    normalized.getUTCDate() !== requested.day ||
    normalized.getUTCHours() !== requested.hour ||
    normalized.getUTCMinutes() !== requested.minute ||
    normalized.getUTCSeconds() !== requested.second ||
    normalized.getUTCMilliseconds() !== requested.millisecond
  ) {
    return null
  }
  // Two-pass offset resolution so instants near a DST transition land correctly.
  let ts = utcGuess - tzOffsetMs(timeZone, new Date(utcGuess))
  const refined = tzOffsetMs(timeZone, new Date(ts))
  ts = utcGuess - refined
  const parsed = new Date(ts)
  const actual = wallClockParts(timeZone, parsed)
  // Reject wall-clock times that do not exist during a DST spring-forward gap.
  // JavaScript otherwise normalizes them to a different local time silently.
  if (
    actual.year !== requested.year ||
    actual.month !== requested.month ||
    actual.day !== requested.day ||
    actual.hour !== requested.hour ||
    actual.minute !== requested.minute ||
    actual.second !== requested.second ||
    parsed.getUTCMilliseconds() !== requested.millisecond
  ) {
    return null
  }
  return parsed
}

/** Human-readable date + time (e.g. `Jun 11, 2026, 2:30 PM`) in the given timezone. */
export function formatDateTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

/** Human-readable date (e.g. `Jun 11, 2026`) in the given timezone. */
export function formatDate(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, dateStyle: 'medium' }).format(d)
}
