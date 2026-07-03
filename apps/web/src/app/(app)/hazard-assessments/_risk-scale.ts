// Single risk-rating ceiling for the module's server actions. Mirrors
// MAX_AXIS in apps/web/src/components/risk-matrix.tsx — that module is
// 'use client', so server actions cannot import values from it directly.
// Keep the two in sync: a rating field must be able to store the top index
// of the largest matrix the editor allows.
export const RISK_AXIS_MAX = 6

/**
 * Coerce an incoming risk-rating form value to a clamped 1..RISK_AXIS_MAX
 * integer, or null when the field is empty / not a number / out of range.
 */
export function riskRating(v: FormDataEntryValue | null): number | null {
  if (v === null) return null
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const i = Math.round(n)
  if (i < 1 || i > RISK_AXIS_MAX) return null
  return i
}
