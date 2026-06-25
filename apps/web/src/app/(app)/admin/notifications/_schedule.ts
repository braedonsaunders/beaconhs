// Shared, pure helpers for the per-tenant compliance DETECTION schedule.
// Imported by the notifications cockpit (client) AND the save action (server),
// so this MUST stay free of server/db imports. The worker evaluates the cron in
// the tenant's timezone; these helpers only translate friendly presets <-> cron
// and validate the subset of cron syntax the worker's parser accepts.

export const DEFAULT_SCAN_CRON = '0 6 * * *'
export const DEFAULT_SCAN_TZ = 'UTC'

export type SchedulePreset = 'hourly' | 'every_6h' | 'twice_daily' | 'daily' | 'weekly' | 'custom'

export const SCHEDULE_PRESETS: { value: SchedulePreset; label: string }[] = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'every_6h', label: 'Every 6 hours' },
  { value: 'twice_daily', label: 'Twice a day' },
  { value: 'daily', label: 'Once a day' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'custom', label: 'Custom (cron)' },
]

export const WEEKDAYS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
] as const

const clampHour = (h: number) => Math.min(23, Math.max(0, Math.round(Number.isFinite(h) ? h : 6)))
const clampDow = (d: number) => Math.min(6, Math.max(0, Math.round(Number.isFinite(d) ? d : 1)))

/** Compile a friendly preset selection into a 5-field cron string. */
export function compileCron(
  preset: SchedulePreset,
  hour: number,
  weekday: number,
  custom: string,
): string {
  const h = clampHour(hour)
  switch (preset) {
    case 'hourly':
      return '0 * * * *'
    case 'every_6h':
      return '0 */6 * * *'
    case 'twice_daily':
      return `0 ${h},${(h + 12) % 24} * * *`
    case 'daily':
      return `0 ${h} * * *`
    case 'weekly':
      return `0 ${h} * * ${clampDow(weekday)}`
    case 'custom':
      return custom.trim() || DEFAULT_SCAN_CRON
  }
}

/** Best-effort decompile a stored cron back into preset + hour + weekday for the UI. */
export function decompileCron(cron: string): {
  preset: SchedulePreset
  hour: number
  weekday: number
  custom: string
} {
  const c = (cron || DEFAULT_SCAN_CRON).trim()
  const base = { hour: 6, weekday: 1, custom: c }
  if (c === '0 * * * *') return { ...base, preset: 'hourly' }
  if (c === '0 */6 * * *') return { ...base, preset: 'every_6h' }
  let m: RegExpExecArray | null
  if ((m = /^0 (\d{1,2}),(\d{1,2}) \* \* \*$/.exec(c))) {
    const a = Number(m[1])
    const b = Number(m[2])
    if ((a + 12) % 24 === b % 24) return { ...base, preset: 'twice_daily', hour: a }
  }
  if ((m = /^0 (\d{1,2}) \* \* \*$/.exec(c))) return { ...base, preset: 'daily', hour: Number(m[1]) }
  if ((m = /^0 (\d{1,2}) \* \* ([0-6])$/.exec(c)))
    return { ...base, preset: 'weekly', hour: Number(m[1]), weekday: Number(m[2]) }
  return { ...base, preset: 'custom' }
}

/** Validate the cron subset the worker's parseCron accepts: `*`, lists, `*​/n`, numbers. */
export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const bounds: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ]
  return parts.every((p, i) => {
    const [lo, hi] = bounds[i]!
    return p.split(',').every((tok) => {
      if (tok === '*') return true
      const step = /^(\*|\d+)\/(\d+)$/.exec(tok)
      if (step) return Number(step[2]) > 0
      const n = Number(tok)
      return Number.isInteger(n) && n >= lo && n <= hi
    })
  })
}

/** Validate an IANA timezone id (or 'UTC'). Safe in both client + server. */
export function isValidTimezone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}
