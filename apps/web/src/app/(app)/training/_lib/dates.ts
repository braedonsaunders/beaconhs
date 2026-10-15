// Shared date math for training expiry computation. Every path that mints or
// renews a training record / skill assignment must compute expiry the same way:
// UTC calendar-month addition with end-of-month clamping (Jan 31 + 1 month →
// Feb 28, never Mar 3). Used by class completion, LMS completion, assessment
// passes, renewals, and the bulk renew action — one formula, no drift.
// "Today" for a new or renewed record is the worker's local date:
// `dateIsoInTimeZone(new Date(), ctx.timezone)` from @/lib/datetime.

/** Add calendar months to an ISO `YYYY-MM-DD` date (UTC, month-end clamped). */
export function addMonthsIso(iso: string, months: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  const day = d.getUTCDate()
  d.setUTCMonth(d.getUTCMonth() + months)
  // If the target month is shorter, JS rolls over into the next month; clamp back.
  if (d.getUTCDate() < day) d.setUTCDate(0)
  return d.toISOString().slice(0, 10)
}
