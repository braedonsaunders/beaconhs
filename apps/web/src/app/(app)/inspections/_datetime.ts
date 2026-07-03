/**
 * Format a Date for a `<input type="datetime-local">` value. `toISOString()`
 * alone renders UTC as if it were wall-clock time and shifts the value by the
 * timezone offset — this corrects for that.
 */
export function localDatetimeValue(d: Date = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/**
 * Parse a `YYYY-MM-DD` filter value into a local-time Date at the start or end
 * of that day. Returns null for anything malformed so a bad query-string value
 * never reaches the database as an Invalid Date. `edge: 'end'` makes date-range
 * upper bounds inclusive of the whole chosen day.
 */
export function parseDateFilter(raw: string | undefined, edge: 'start' | 'end'): Date | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const d = new Date(edge === 'end' ? `${raw}T23:59:59.999` : `${raw}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}
