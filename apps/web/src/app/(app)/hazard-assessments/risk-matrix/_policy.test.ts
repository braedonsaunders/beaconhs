import { describe, expect, it } from 'vitest'
import type { RiskMatrixConfig } from '@beaconhs/db/schema'
import { RISK_MATRIX_LABEL_MAX, validateRiskMatrixConfig } from './_policy'

function matrixFixture(): RiskMatrixConfig {
  return {
    axes: {
      severity: { values: ['Minor', 'Major'] },
      likelihood: { values: ['Rare', 'Likely'] },
    },
    cells: {
      '0:0': { score: 1, label: 'Low', color: '#10b981' },
      '0:1': { score: 2, label: 'Moderate', color: '#f59e0b' },
      '1:0': { score: 2, label: 'Moderate', color: '#f59e0b' },
      '1:1': { score: 4, label: 'High', color: '#dc2626' },
    },
  }
}

describe('risk matrix mutation policy', () => {
  it('accepts and normalizes the canonical matrix', () => {
    const result = validateRiskMatrixConfig(matrixFixture())
    expect(result.ok).toBe(true)
  })

  it('rejects overlong or duplicate axis labels instead of truncating them', () => {
    const long = matrixFixture()
    long.axes.severity.values[0] = 'x'.repeat(RISK_MATRIX_LABEL_MAX + 1)
    expect(validateRiskMatrixConfig(long)).toMatchObject({ ok: false })

    const duplicate = matrixFixture()
    duplicate.axes.likelihood.values[1] = duplicate.axes.likelihood.values[0]!.toUpperCase()
    expect(validateRiskMatrixConfig(duplicate)).toMatchObject({ ok: false })
  })

  it('rejects malformed scores, colours, and cell labels', () => {
    const score = matrixFixture()
    score.cells['0:0']!.score = 99
    expect(validateRiskMatrixConfig(score)).toMatchObject({ ok: false })

    const color = matrixFixture()
    color.cells['0:0']!.color = 'red'
    expect(validateRiskMatrixConfig(color)).toMatchObject({ ok: false })

    const label = matrixFixture()
    label.cells['0:0']!.label = ''
    expect(validateRiskMatrixConfig(label)).toMatchObject({ ok: false })
  })
})
