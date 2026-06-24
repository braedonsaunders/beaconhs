import 'server-only'

// Shared value formatters for module flow adapters' loadValues(). Collections
// and resolved joins are formatted HERE (display-ready strings) so authored
// email templates ({{#each}} tables) render cleanly without per-template logic.

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** `YYYY-MM-DD HH:mm` in server-local time; '' for null / invalid. */
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return ''
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}

/** `YYYY-MM-DD`; '' for null / invalid. Accepts a date string (date columns). */
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return ''
  if (typeof d === 'string') {
    // `date` columns arrive as 'YYYY-MM-DD' already.
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(d)
    if (m?.[1]) return m[1]
  }
  const dt = typeof d === 'string' ? new Date(d) : d
  if (Number.isNaN(dt.getTime())) return ''
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
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
