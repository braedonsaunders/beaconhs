import { describe, expect, it } from 'vitest'
import { computeSafeDistance, convertToMeters, segmentVolumeM3 } from './_lib'

// Parity tests for the pneumatic pressure-test engine ported from the legacy
// beaconhs SafeDistanceApiController. We can't run the legacy PHP here, so the
// strongest guarantee is INTERNAL CONSISTENCY: the same physical system,
// expressed in metric vs imperial, must produce results that differ only by the
// 3.28084 m→ft factor. We anchor that with a hand-computed concrete case and
// lock the ASME energy floors + the NASA D1000 table behaviour.

const M_TO_FT = 3.28084

// A 6" ID × 120" pipe at 100 psi — the canonical worked example.
const imperialCase = {
  method: 'nasa' as const,
  unit: 'imperial' as const,
  testPressure: 100, // psi
  segments: [{ unit: 'inch' as const, lengthValue: 120, internalDiameter: 6 }],
}

// The same physical system in metric: 3.048 m × 0.1524 m, 6.894757 bar (=100 psi).
const metricCase = {
  method: 'nasa' as const,
  unit: 'metric' as const,
  testPressure: 100 * 0.06894757, // bar
  segments: [{ unit: 'm' as const, lengthValue: 3.048, internalDiameter: 0.1524 }],
}

describe('convertToMeters', () => {
  it('converts each supported unit to metres', () => {
    expect(convertToMeters(1, 'inch')).toBeCloseTo(0.0254, 6)
    expect(convertToMeters(1, 'feet')).toBeCloseTo(0.3048, 6)
    expect(convertToMeters(1000, 'mm')).toBeCloseTo(1, 6)
    expect(convertToMeters(100, 'cm')).toBeCloseTo(1, 6)
    expect(convertToMeters(5, 'm')).toBe(5)
  })
})

describe('segmentVolumeM3', () => {
  it('computes π·(d/2)²·L for a 6in × 120in pipe (~0.0556 m³)', () => {
    expect(segmentVolumeM3(120, 6, 'inch')).toBeCloseTo(0.055601, 5)
  })
  it('returns 0 for degenerate input', () => {
    expect(segmentVolumeM3(0, 6, 'inch')).toBe(0)
    expect(segmentVolumeM3(120, 0, 'inch')).toBe(0)
  })
})

describe('computeSafeDistance — worked imperial case', () => {
  const r = computeSafeDistance(imperialCase)
  it('total volume ≈ 1.9636 ft³', () => {
    expect(r.totalVolume).toBeCloseTo(1.9636, 3)
    expect(r.totalVolumeM3).toBeCloseTo(0.055601, 5)
  })
  it('NASA ≈ 16.28 ft (0.1 · D1000(100=130) · V_ft³^⅓)', () => {
    expect(r.nasa).toBeCloseTo(16.28, 1)
  })
  it("Lloyd's ≈ 6.90 ft", () => {
    expect(r.lloyds).toBeCloseTo(6.9, 1)
  })
  it('ASME hits the 30 m floor → ≈ 98.43 ft (low stored energy)', () => {
    expect(r.asme).toBeCloseTo(30 * M_TO_FT, 1)
  })
  it('chosen mirrors the selected method', () => {
    expect(r.chosen).toBe(r.nasa)
    expect(computeSafeDistance({ ...imperialCase, method: 'asme' }).chosen).toBe(r.asme)
    expect(computeSafeDistance({ ...imperialCase, method: 'lloyds' }).chosen).toBe(r.lloyds)
  })
})

describe('metric ↔ imperial consistency', () => {
  const imp = computeSafeDistance(imperialCase)
  const met = computeSafeDistance(metricCase)
  it('same physical volume regardless of unit system', () => {
    expect(met.totalVolumeM3).toBeCloseTo(imp.totalVolumeM3, 5)
  })
  it('every method result differs only by the m→ft factor', () => {
    expect(imp.nasa).toBeCloseTo(met.nasa * M_TO_FT, 4)
    expect(imp.lloyds).toBeCloseTo(met.lloyds * M_TO_FT, 4)
    expect(imp.asme).toBeCloseTo(met.asme * M_TO_FT, 4)
  })
})

describe('ASME stored-energy floors', () => {
  it('an empty system still returns the 30 m ASME floor; NASA + Lloyd are 0', () => {
    const r = computeSafeDistance({
      method: 'asme',
      unit: 'metric',
      testPressure: 10,
      segments: [],
    })
    expect(r.nasa).toBe(0)
    expect(r.lloyds).toBe(0)
    expect(r.asme).toBe(30)
    expect(r.totalVolume).toBe(0)
  })
  it('a large high-pressure system exceeds the floors (R governs)', () => {
    // 50 m of 0.5 m ID at 200 bar → high stored energy, R_m well above 60.
    const r = computeSafeDistance({
      method: 'asme',
      unit: 'metric',
      testPressure: 200,
      segments: [{ unit: 'm', lengthValue: 50, internalDiameter: 0.5 }],
    })
    expect(r.asme).toBeGreaterThan(60)
  })
})

describe('NASA D1000 table', () => {
  it('scales NASA distance by the D1000 step (150kPa-step at 150psi=150 vs 100psi=130)', () => {
    const at100 = computeSafeDistance(imperialCase)
    const at150 = computeSafeDistance({ ...imperialCase, testPressure: 150 })
    // Same volume; NASA is linear in D1000, so the ratio is 150/130.
    expect(at150.nasa / at100.nasa).toBeCloseTo(150 / 130, 3)
  })
  it('pressures above the last table row reuse the final D1000 (910)', () => {
    const at9000 = computeSafeDistance({ ...imperialCase, testPressure: 9000 })
    const at20000 = computeSafeDistance({ ...imperialCase, testPressure: 20000 })
    expect(at20000.nasa).toBeCloseTo(at9000.nasa, 4)
  })
})
