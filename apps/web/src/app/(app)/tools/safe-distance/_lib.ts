// Pneumatic pressure-test safe-distance engine.
//
// Ported verbatim from the legacy beaconhs SafeDistanceApiController so results
// match the system being replaced. Pure functions only — shared by the client
// live-preview island and the server save action (which is authoritative).
//
// Stored energy released when a pressurised system fails is an explosion
// hazard; these three standards each estimate a minimum personnel stand-off:
//   - NASA-Glenn Research Safety Manual  (stepped D1000 table × volume^⅓)
//   - ASME PCC-2 Article 5.1             (stored energy → TNT-equivalent → R)
//   - Lloyd's Register form T-0240 S4.3  (volume × pressure term, ^0.33)
//
// Units. A record is either 'metric' (bar / m³ / m) or 'imperial' (psi / ft³ /
// ft). Test pressure is entered in that system; every pipe segment carries its
// own length/diameter unit and is normalised to metres for the volume integral.

export type SafeDistanceMethod = 'nasa' | 'asme' | 'lloyds'
export type SafeDistanceUnit = 'metric' | 'imperial'
export type SafeDistanceSegmentUnit = 'inch' | 'feet' | 'mm' | 'cm' | 'm'

export const SAFE_DISTANCE_METHOD_LABELS: Record<SafeDistanceMethod, string> = {
  nasa: 'NASA-Glenn',
  asme: 'ASME PCC-2',
  lloyds: "Lloyd's Register",
}

export const SAFE_DISTANCE_METHOD_SUBTITLES: Record<SafeDistanceMethod, string> = {
  nasa: 'Research Safety Manual',
  asme: 'Art. 5.1 — 2008',
  lloyds: '(96-02) Form T-0240 S4.3',
}

export const SAFE_DISTANCE_UNIT_LABELS: Record<SafeDistanceUnit, string> = {
  metric: 'Metric',
  imperial: 'Imperial',
}

export const SEGMENT_UNIT_LABELS: Record<SafeDistanceSegmentUnit, string> = {
  inch: 'Inch',
  feet: 'Feet',
  mm: 'Millimetre (mm)',
  cm: 'Centimetre (cm)',
  m: 'Metre (m)',
}

export const SEGMENT_UNITS: SafeDistanceSegmentUnit[] = ['inch', 'feet', 'mm', 'cm', 'm']

/** Unit label shown next to the test-pressure input. */
export function pressureUnitLabel(unit: SafeDistanceUnit): string {
  return unit === 'metric' ? 'bar' : 'psi'
}

/** Unit label shown for total volume. */
export function volumeUnitLabel(unit: SafeDistanceUnit): string {
  return unit === 'metric' ? 'm³' : 'ft³'
}

/** Unit label shown for the computed distances. */
export function distanceUnitLabel(unit: SafeDistanceUnit): string {
  return unit === 'metric' ? 'm' : 'ft'
}

// --- Conversions ------------------------------------------------------------

const M3_TO_FT3 = 35.3147
const M_TO_FT = 3.28084
const PSI_PER_BAR = 14.5037738

/** Convert a length value in the given segment unit to metres. */
export function convertToMeters(value: number, unit: SafeDistanceSegmentUnit): number {
  switch (unit) {
    case 'inch':
      return value * 0.0254
    case 'feet':
      return value * 0.3048
    case 'mm':
      return value * 0.001
    case 'cm':
      return value * 0.01
    case 'm':
      return value
    default:
      return value
  }
}

/** Convert a test pressure between psi and bar (display-only helper). */
export function convertPressure(value: number, to: SafeDistanceUnit): number {
  if (!Number.isFinite(value)) return 0
  // to 'metric' ⇒ value is psi → bar; to 'imperial' ⇒ value is bar → psi.
  return to === 'metric' ? value / PSI_PER_BAR : value * PSI_PER_BAR
}

// --- Segment volume ---------------------------------------------------------

/** Volume of one pipe segment in m³: π·(d/2)²·L (length + diameter in `unit`). */
export function segmentVolumeM3(
  lengthValue: number,
  internalDiameter: number,
  unit: SafeDistanceSegmentUnit,
): number {
  const lengthM = convertToMeters(Number(lengthValue) || 0, unit)
  const diamM = convertToMeters(Number(internalDiameter) || 0, unit)
  const radius = diamM / 2
  const vol = Math.PI * radius * radius * lengthM
  return Number.isFinite(vol) && vol > 0 ? vol : 0
}

// --- NASA-Glenn D1000 table -------------------------------------------------
//
// Keyed on test pressure in psi → D1000 coefficient. The legacy lookup picks
// the first key the pressure is ≤; pressures above the last key reuse the last
// value (910). Order matters — keep ascending.
const D1000_TABLE: ReadonlyArray<readonly [psi: number, d1000: number]> = [
  [10, 10],
  [20, 30],
  [30, 60],
  [40, 80],
  [50, 90],
  [60, 95],
  [70, 100],
  [80, 110],
  [90, 120],
  [100, 130],
  [150, 150],
  [200, 190],
  [250, 200],
  [300, 230],
  [350, 250],
  [400, 260],
  [450, 270],
  [500, 290],
  [550, 300],
  [600, 310],
  [650, 320],
  [700, 330],
  [750, 340],
  [850, 360],
  [900, 375],
  [950, 380],
  [1000, 390],
  [1500, 440],
  [2000, 500],
  [2500, 550],
  [3000, 590],
  [4000, 640],
  [5000, 700],
  [6000, 750],
  [7000, 800],
  [8000, 850],
  [9000, 910],
]

function lookupD1000(testPressurePsi: number): number {
  for (const [psi, d1000] of D1000_TABLE) {
    if (testPressurePsi <= psi) return d1000
  }
  return D1000_TABLE[D1000_TABLE.length - 1]![1]
}

// --- Core calculation -------------------------------------------------------

export type SafeDistanceComputeInput = {
  method: SafeDistanceMethod
  unit: SafeDistanceUnit
  /** Test pressure in the record's unit system (psi for imperial, bar for metric). */
  testPressure: number
  segments: Array<{
    unit: SafeDistanceSegmentUnit
    lengthValue: number
    internalDiameter: number
  }>
}

export type SafeDistanceResults = {
  /** Total system volume in the record's display unit (m³ or ft³). */
  totalVolume: number
  /** Total system volume in m³ (canonical) — handy for storing per-segment vols. */
  totalVolumeM3: number
  /** Computed distances in the record's display unit (m or ft). */
  nasa: number
  asme: number
  lloyds: number
  /** Whichever distance the chosen `method` selects. */
  chosen: number
}

/**
 * Compute total volume + all three method distances for a record. Mirrors the
 * legacy `calculateSafeDistance()` exactly, including its unit conventions.
 */
export function computeSafeDistance(input: SafeDistanceComputeInput): SafeDistanceResults {
  const { method, unit, segments } = input

  let totalVolumeM3 = 0
  for (const s of segments) {
    totalVolumeM3 += segmentVolumeM3(s.lengthValue, s.internalDiameter, s.unit)
  }
  totalVolumeM3 = Math.max(totalVolumeM3, 0)

  const rawPressure = Number(input.testPressure) || 0
  let pressurePsi: number
  let pressurePa: number
  let pressureBar: number
  if (unit === 'metric') {
    pressureBar = rawPressure
    pressurePa = pressureBar * 100000 // 1 bar = 100,000 Pa
    pressurePsi = pressureBar * PSI_PER_BAR
  } else {
    pressurePsi = rawPressure
    pressurePa = pressurePsi * 6894.757
    pressureBar = pressurePsi * 0.06894757
  }

  // NASA — volume in ft³, distance in ft.
  const volumeFt3 = totalVolumeM3 * M3_TO_FT3
  const d1000 = lookupD1000(pressurePsi)
  const nasaFt = volumeFt3 > 0 ? 0.1 * d1000 * Math.cbrt(volumeFt3) : 0

  // Lloyd's — distance in m.
  const lloydsTerm = pressureBar + 1 - Math.pow(pressureBar + 1, 0.714)
  const lloydsM = totalVolumeM3 > 0 ? 3.6 * Math.pow(totalVolumeM3 * lloydsTerm, 0.33) : 0

  // ASME — stored energy → TNT-equivalent → blast radius, in m.
  const altitude = 100.0
  const absAtmosphericPa = 101325 * Math.pow(1 - 0.0000225577 * altitude, 5.25588)
  let storedEnergyJ = 0
  if (totalVolumeM3 > 0 && pressurePa > 0) {
    storedEnergyJ =
      2.5 * pressurePa * totalVolumeM3 * (1 - Math.pow(absAtmosphericPa / pressurePa, 0.286))
  }
  const tntKg = storedEnergyJ / 4266920
  const blastRadiusM = tntKg > 0 ? 20 * Math.cbrt(2 * tntKg) : 0
  let asmeM: number
  if (storedEnergyJ <= 135500000) {
    asmeM = Math.max(30, blastRadiusM)
  } else if (storedEnergyJ <= 271000000) {
    asmeM = Math.max(60, blastRadiusM)
  } else {
    asmeM = blastRadiusM
  }

  let nasa: number
  let lloyds: number
  let asme: number
  let totalVolume: number
  if (unit === 'metric') {
    nasa = nasaFt / M_TO_FT
    lloyds = lloydsM
    asme = asmeM
    totalVolume = totalVolumeM3
  } else {
    nasa = nasaFt
    lloyds = lloydsM * M_TO_FT
    asme = asmeM * M_TO_FT
    totalVolume = volumeFt3
  }

  const chosen = method === 'nasa' ? nasa : method === 'asme' ? asme : lloyds

  return { totalVolume, totalVolumeM3, nasa, asme, lloyds, chosen }
}

// --- Formatting -------------------------------------------------------------

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === 'string' ? Number(value) : value
  return Number.isFinite(n) ? n : null
}

/** Format a distance (numeric column may arrive as a string) as "X.XX <unit>". */
export function formatDistance(
  value: string | number | null | undefined,
  unit: SafeDistanceUnit,
): string {
  const n = toNumber(value)
  if (n === null) return '—'
  return `${n.toFixed(2)} ${distanceUnitLabel(unit)}`
}

/** Format a volume as "X.XXXX <unit>". */
export function formatVolume(
  value: string | number | null | undefined,
  unit: SafeDistanceUnit,
): string {
  const n = toNumber(value)
  if (n === null) return '—'
  return `${n.toFixed(4)} ${volumeUnitLabel(unit)}`
}

/** Format a test pressure as "X.XX <unit>". */
export function formatPressure(
  value: string | number | null | undefined,
  unit: SafeDistanceUnit,
): string {
  const n = toNumber(value)
  if (n === null) return '—'
  return `${n.toFixed(2)} ${pressureUnitLabel(unit)}`
}
