import { describe, expect, it } from 'vitest'
import { INCIDENT_METRICS, incidentMetricAnswer } from './incident-metrics'

describe('incident reporting scales', () => {
  it('exports selected descriptions and leaves historical unanswered metrics blank', () => {
    for (const metric of INCIDENT_METRICS) {
      expect(incidentMetricAnswer(metric, null)).toBe('')
      expect(incidentMetricAnswer(metric, 0)).toBe('')
      expect(incidentMetricAnswer(metric, 6)).toBe('')
      expect(incidentMetricAnswer(metric, 1)).toBe(`1 — ${metric.options[0]}`)
      expect(incidentMetricAnswer(metric, 5)).toBe(`5 — ${metric.options[4]}`)
    }
  })
  it('uses identical injury and damage thresholds for actual and potential severity', () => {
    expect(INCIDENT_METRICS[0].options).toEqual(INCIDENT_METRICS[1].options)
    expect(INCIDENT_METRICS[0].options[1]).toContain('No property damage')
    expect(INCIDENT_METRICS[0].options[3]).toContain('from $5,000 to less than $25,000')
    expect(INCIDENT_METRICS[0].options[4]).toContain('$25,000 or more')
  })
})
