/**
 * Format a Date for a `<input type="datetime-local">` value. `toISOString()`
 * alone renders UTC as if it were wall-clock time and shifts the value by the
 * timezone offset — this corrects for that.
 */
export function localDatetimeValue(d: Date = new Date()): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
