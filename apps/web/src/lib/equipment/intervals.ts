// Interval helpers for equipment maintenance cadences ("every N
// day/week/month/year"). Client-safe — imported by server pages, actions, and
// drawer components alike.

export type EquipmentIntervalUnit = 'day' | 'week' | 'month' | 'year'

export const EQUIPMENT_INTERVAL_UNITS: {
  value: EquipmentIntervalUnit
  singular: string
  plural: string
}[] = [
  { value: 'day', singular: 'day', plural: 'days' },
  { value: 'week', singular: 'week', plural: 'weeks' },
  { value: 'month', singular: 'month', plural: 'months' },
  { value: 'year', singular: 'year', plural: 'years' },
]

const UNIT_VALUES = new Set(EQUIPMENT_INTERVAL_UNITS.map((u) => u.value))

export function parseIntervalUnit(raw: unknown): EquipmentIntervalUnit | null {
  return typeof raw === 'string' && UNIT_VALUES.has(raw as EquipmentIntervalUnit)
    ? (raw as EquipmentIntervalUnit)
    : null
}

/**
 * Human label for a cadence. Common cadences get their conventional names
 * (Daily / Weekly / Monthly / Annual); everything else reads "Every N units".
 * Null value/unit = "On demand"; `preUse` wins over everything.
 */
export function formatInterval(
  value: number | null | undefined,
  unit: EquipmentIntervalUnit | null | undefined,
  opts?: { preUse?: boolean },
): string {
  if (opts?.preUse) return 'Pre-use'
  if (!value || !unit) return 'On demand'
  if (value === 1) {
    if (unit === 'day') return 'Daily'
    if (unit === 'week') return 'Weekly'
    if (unit === 'month') return 'Monthly'
    return 'Annual'
  }
  const meta = EQUIPMENT_INTERVAL_UNITS.find((u) => u.value === unit)!
  return `Every ${value} ${meta.plural}`
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** `from` + N units, as a YYYY-MM-DD date string (UTC date math). */
export function addInterval(from: Date, value: number, unit: EquipmentIntervalUnit): string {
  const next = new Date(from)
  if (unit === 'day') next.setUTCDate(next.getUTCDate() + value)
  else if (unit === 'week') next.setUTCDate(next.getUTCDate() + value * 7)
  else if (unit === 'month') next.setUTCMonth(next.getUTCMonth() + value)
  else next.setUTCFullYear(next.getUTCFullYear() + value)
  return dateOnly(next)
}

/** Same as addInterval but from a YYYY-MM-DD string. */
export function addIntervalToDate(
  fromIso: string,
  value: number,
  unit: EquipmentIntervalUnit,
): string {
  return addInterval(new Date(`${fromIso}T00:00:00Z`), value, unit)
}
