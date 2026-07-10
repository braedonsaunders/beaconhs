// Shared date/standing helpers for the public badge transcript pages. Plain
// module (no 'use client') so both server pages and the client list import
// the SAME logic — date-only strings compare as strings; parsing yyyy-mm-dd
// as a Date would flip status at UTC midnight on the final valid day.

export const EXPIRING_DAYS = 60

export type Standing = 'valid' | 'expiring' | 'expired'

export function standingFor(expiresOn: string | null, todayIso: string, soonIso: string): Standing {
  if (!expiresOn) return 'valid'
  if (expiresOn < todayIso) return 'expired'
  if (expiresOn <= soonIso) return 'expiring'
  return 'valid'
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isoDaysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function formatDay(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return value
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}
