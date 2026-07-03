// Timezone-aware datetime helpers for the module's server components/actions.
//
// Server components render on the deploy container's clock (UTC in prod), so
// both directions of a `<input type="datetime-local">` round-trip must be
// pinned to the viewer's IANA timezone (`ctx.timezone` on RequestContext):
// format the stored instant into the user's wall-clock for display, and parse
// the posted wall-clock string back into an instant in that same zone.

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
  const utcGuess = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
    Number((m[7] ?? '').padEnd(3, '0') || 0),
  )
  if (Number.isNaN(utcGuess)) return null
  // Two-pass offset resolution so instants near a DST transition land correctly.
  let ts = utcGuess - tzOffsetMs(timeZone, new Date(utcGuess))
  const refined = tzOffsetMs(timeZone, new Date(ts))
  ts = utcGuess - refined
  return new Date(ts)
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
