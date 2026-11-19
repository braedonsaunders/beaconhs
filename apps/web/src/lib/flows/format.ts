import 'server-only'
import { dateIsoInTimeZone, datetimeLocalValue } from '@/lib/datetime'

// Shared value formatters for module flow adapters' loadValues(). Collections
// and resolved joins are formatted HERE (display-ready strings) so authored
// email templates ({{#each}} tables) render cleanly without per-template logic.

/**
 * `YYYY-MM-DD HH:mm` on the tenant's wall clock; '' for null / invalid.
 * Always pass the tenant's time zone (`ctx.timezone`): the servers run in UTC,
 * so formatting in server-local time would print UTC times on PDFs and emails.
 */
export function fmtDateTime(d: Date | string | null | undefined, timeZone: string): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return ''
  return datetimeLocalValue(dt, timeZone).replace('T', ' ')
}

/**
 * `YYYY-MM-DD` on the tenant's calendar; '' for null / invalid. `date` columns
 * ('YYYY-MM-DD') are already calendar days and pass through unchanged.
 */
export function fmtDate(d: Date | string | null | undefined, timeZone: string): string {
  if (!d) return ''
  if (typeof d === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})(?![T ]\d)/.exec(d)
    if (m?.[1]) return m[1]
  }
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return ''
  return dateIsoInTimeZone(dt, timeZone)
}

/** Person display name: formalName, else "First Last"; '' when absent. */
export function personName(
  p: { firstName?: string | null; lastName?: string | null; formalName?: string | null } | null,
): string {
  if (!p) return ''
  if (p.formalName) return p.formalName
  return [p.firstName, p.lastName].filter(Boolean).join(' ')
}

/** Boolean → 'Yes' / 'No'. */
export function yesNo(v: unknown): string {
  return v ? 'Yes' : 'No'
}

/** Boolean → 'Yes' / '' (for sparse flag columns shown only when true). */
export function yesBlank(v: unknown): string {
  return v ? 'Yes' : ''
}

/** snake_case / enum value → sentence-case label ('near_miss' → 'Near miss'). */
export function titleize(s: string | null | undefined): string {
  if (!s) return ''
  const t = String(s).replace(/_/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}
