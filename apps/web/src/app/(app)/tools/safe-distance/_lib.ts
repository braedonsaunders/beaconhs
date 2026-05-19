// Safe-distance engineering helpers.
//
// All distances are in metres. Voltages in kV. Use these helpers from both
// the new-record form (computing what's required given the inputs) and from
// the detail page (re-deriving for display in case the underlying tables
// shift between record creation and read).
//
// Electrical: based on the IEEE C2 / CSA Z462 / OHS limits-of-approach steps
// commonly adopted across Canadian utilities. The rounded thresholds below
// match the legacy Beacon table — if your jurisdiction needs different values
// you can add a row to ELECTRICAL_TABLE without touching callers.
//
// Drone: based on Transport Canada's RPAS distance rules — 30 m clearance
// from non-involved people for basic ops, regardless of altitude or rotor count.
//
// Vehicle / overhead-crane / other: no canonical lookup; the operator supplies
// the actual measured distance and a 2 m default minimum is applied unless a
// specific source description triggers an alternative path.

export type SafeDistanceType =
  | 'electrical'
  | 'drone'
  | 'overhead_crane'
  | 'vehicle'
  | 'other'

export const SAFE_DISTANCE_TYPE_LABELS: Record<SafeDistanceType, string> = {
  electrical: 'Electrical proximity',
  drone: 'Drone clearance',
  overhead_crane: 'Overhead crane to energised conductor',
  vehicle: 'Vehicle proximity',
  other: 'Other',
}

// Electrical limits of approach. Each row: voltages strictly LESS THAN
// `maxVoltageKv` use `requiredDistanceM`. The final row's maxVoltageKv is
// Infinity — anything above 750 kV requires a custom engineering review and
// we round up conservatively to 9.0 m to enforce "stop and re-assess".
export const ELECTRICAL_TABLE: { maxVoltageKv: number; requiredDistanceM: number }[] = [
  { maxVoltageKv: 0.75, requiredDistanceM: 0.9 },
  { maxVoltageKv: 150, requiredDistanceM: 3.05 },
  { maxVoltageKv: 250, requiredDistanceM: 4.6 },
  { maxVoltageKv: 550, requiredDistanceM: 6.1 },
  { maxVoltageKv: 750, requiredDistanceM: 8.0 },
  { maxVoltageKv: Number.POSITIVE_INFINITY, requiredDistanceM: 9.0 },
]

export const DRONE_DEFAULT_CLEARANCE_M = 30
export const VEHICLE_DEFAULT_CLEARANCE_M = 2
export const CRANE_FALLBACK_CLEARANCE_M = 3.05

/**
 * Given an assessment input, compute the minimum required distance in metres.
 *
 *   electrical → ELECTRICAL_TABLE lookup using the supplied kV
 *   drone      → 30 m (no waiver implemented yet; legacy stored a flag we
 *                ignore here — operators can override `requiredDistanceM`
 *                manually before submitting)
 *   overhead_crane → if voltage supplied, use ELECTRICAL_TABLE; else fall back
 *                    to the 3.05 m default for unspecified overhead conductors
 *   vehicle    → 2 m default; the operator can override
 *   other      → 0 (caller must supply requiredDistanceM directly)
 */
export function computeRequiredDistanceM(args: {
  type: SafeDistanceType
  voltageKv?: number | null
  heightM?: number | null
}): number {
  const { type, voltageKv } = args
  if (type === 'electrical' || (type === 'overhead_crane' && typeof voltageKv === 'number')) {
    const kv = Math.max(0, Number(voltageKv ?? 0))
    const row = ELECTRICAL_TABLE.find((r) => kv < r.maxVoltageKv)
    return row?.requiredDistanceM ?? CRANE_FALLBACK_CLEARANCE_M
  }
  if (type === 'drone') return DRONE_DEFAULT_CLEARANCE_M
  if (type === 'overhead_crane') return CRANE_FALLBACK_CLEARANCE_M
  if (type === 'vehicle') return VEHICLE_DEFAULT_CLEARANCE_M
  return 0
}

/**
 * Format a numeric distance (string from a Drizzle numeric column or a plain
 * number) as "X.XX m" or "—" if missing.
 */
export function formatDistance(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(2)} m`
}

/**
 * Pretty-print a voltage value (numeric column comes back as string).
 */
export function formatVoltage(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '—'
  return `${n} kV`
}

/**
 * Detect a kV mention in the freeform source description so the new-record
 * form can prompt for an explicit voltage on overhead_crane records. Returns
 * the parsed kV or null if none found. Accepts patterns like "13.8 kV",
 * "13.8kV", "13800 V" (converted), and "13,800 V".
 */
export function extractVoltageFromDescription(description: string): number | null {
  if (!description) return null
  const kvMatch = description.match(/(\d+(?:[.,]\d+)?)\s*kv/i)
  if (kvMatch) {
    const n = Number(kvMatch[1]!.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  const vMatch = description.match(/(\d+(?:[.,]\d+)?)\s*v\b/i)
  if (vMatch) {
    const raw = Number(vMatch[1]!.replace(/[, ]/g, ''))
    return Number.isFinite(raw) ? raw / 1000 : null
  }
  return null
}
