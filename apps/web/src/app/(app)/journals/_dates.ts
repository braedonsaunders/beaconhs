import { dateIsoInTimeZone } from '@/lib/datetime'

/** A real calendar date in strict YYYY-MM-DD form, without a time or offset. */
export function isJournalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}

/** Advance the viewer's calendar date, rather than adding 24 hours across DST. */
export function journalDateChoices(
  now: Date,
  timeZone: string,
): { today: string; tomorrow: string } {
  const today = dateIsoInTimeZone(now, timeZone)
  const next = new Date(`${today}T00:00:00.000Z`)
  next.setUTCDate(next.getUTCDate() + 1)
  return { today, tomorrow: next.toISOString().slice(0, 10) }
}
