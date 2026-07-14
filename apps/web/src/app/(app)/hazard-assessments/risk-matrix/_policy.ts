import type { RiskMatrixConfig } from '@beaconhs/db/schema'
import { RISK_AXIS_MAX } from '../_risk-scale'

export const RISK_MATRIX_LABEL_MAX = 48
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

type ValidationResult = { ok: true; value: RiskMatrixConfig } | { ok: false; error: string }

function axisLabels(value: unknown, axis: string): string[] | string {
  if (!Array.isArray(value)) return `${axis} needs labels.`
  if (value.length < 2) return `${axis} needs at least two levels.`
  if (value.length > RISK_AXIS_MAX) {
    return `${axis} can have at most ${RISK_AXIS_MAX} levels.`
  }
  const labels: string[] = []
  for (const candidate of value) {
    if (typeof candidate !== 'string') return `${axis} labels are invalid.`
    const label = candidate.trim()
    if (!label) return `${axis} labels cannot be blank.`
    if (label.length > RISK_MATRIX_LABEL_MAX) {
      return `${axis} labels must be ${RISK_MATRIX_LABEL_MAX} characters or fewer.`
    }
    labels.push(label)
  }
  if (new Set(labels.map((label) => label.toLocaleLowerCase())).size !== labels.length) {
    return `${axis} labels must be unique.`
  }
  return labels
}

export function validateRiskMatrixConfig(value: unknown): ValidationResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'The risk matrix is invalid.' }
  }
  const config = value as Partial<RiskMatrixConfig>
  const severity = axisLabels(config.axes?.severity?.values, 'Severity')
  if (typeof severity === 'string') return { ok: false, error: severity }
  const likelihood = axisLabels(config.axes?.likelihood?.values, 'Likelihood')
  if (typeof likelihood === 'string') return { ok: false, error: likelihood }
  if (!config.cells || typeof config.cells !== 'object' || Array.isArray(config.cells)) {
    return { ok: false, error: 'The matrix is missing its cells.' }
  }

  const cells: RiskMatrixConfig['cells'] = {}
  for (let severityIndex = 0; severityIndex < severity.length; severityIndex += 1) {
    for (let likelihoodIndex = 0; likelihoodIndex < likelihood.length; likelihoodIndex += 1) {
      const key = `${severityIndex}:${likelihoodIndex}`
      const cell = config.cells[key]
      if (!cell || typeof cell !== 'object') {
        return { ok: false, error: 'The matrix is missing one or more cells.' }
      }
      const expectedScore = (severityIndex + 1) * (likelihoodIndex + 1)
      if (cell.score !== expectedScore) {
        return { ok: false, error: 'One or more matrix scores are invalid.' }
      }
      if (typeof cell.label !== 'string' || !cell.label.trim()) {
        return { ok: false, error: 'Every matrix cell needs a label.' }
      }
      const label = cell.label.trim()
      if (label.length > RISK_MATRIX_LABEL_MAX) {
        return {
          ok: false,
          error: `Matrix labels must be ${RISK_MATRIX_LABEL_MAX} characters or fewer.`,
        }
      }
      if (typeof cell.color !== 'string' || !HEX.test(cell.color)) {
        return { ok: false, error: 'One or more matrix colours are invalid.' }
      }
      cells[key] = { score: expectedScore, label, color: cell.color.toLowerCase() }
    }
  }

  return {
    ok: true,
    value: {
      axes: {
        severity: { values: severity },
        likelihood: { values: likelihood },
      },
      cells,
    },
  }
}
