/**
 * How many calendar days a training class occupies.
 *
 * `lengthDays` is authoritative when set — a three-day course is often entered
 * with a single day's start/end times plus lengthDays: 3, which is exactly the
 * shape the schema documents for time integrations. Otherwise fall back to the
 * days actually spanned by starts_at..ends_at.
 *
 * Either way the run begins on the start date, so the calendar can repeat a
 * multi-day class on every day it runs instead of showing it once and leaving
 * the rest of the week looking free.
 */
export function classDayCount(startsAt: Date, endsAt: Date, lengthDays: number | null): number {
  if (lengthDays && lengthDays > 0) return lengthDays
  const first = Date.UTC(startsAt.getFullYear(), startsAt.getMonth(), startsAt.getDate())
  const last = Date.UTC(endsAt.getFullYear(), endsAt.getMonth(), endsAt.getDate())
  return Math.max(1, Math.round((last - first) / 86_400_000) + 1)
}
