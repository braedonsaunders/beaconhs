import { parseDatetimeLocal } from '@/lib/datetime'

/**
 * Parse a `YYYY-MM-DD` filter value into the start or end of that day in the
 * worker's timezone. Returns null for anything malformed so a bad query-string
 * value never reaches the database as an Invalid Date. `edge: 'end'` makes
 * date-range upper bounds inclusive of the whole chosen day.
 */
export function parseDateFilter(
  raw: string | undefined,
  edge: 'start' | 'end',
  timeZone: string,
): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  return parseDatetimeLocal(edge === 'end' ? `${raw}T23:59:59.999` : `${raw}T00:00`, timeZone)
}
