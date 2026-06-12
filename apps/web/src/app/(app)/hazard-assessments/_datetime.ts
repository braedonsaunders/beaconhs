/**
 * Current time formatted for a `<input type="datetime-local">` default.
 * `toISOString()` alone would render UTC as if it were wall-clock time and
 * future-date every new record by the timezone offset.
 */
export function localDatetimeValue(d: Date = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
