import { describe, expect, it } from 'vitest'
import {
  isIncidentFactorCategory,
  isIncidentPreventativeStepStatus,
} from './incident-investigation'

describe('incident investigation inputs', () => {
  it('accepts only persisted contributing-factor categories', () => {
    expect(isIncidentFactorCategory('equipment')).toBe(true)
    expect(isIncidentFactorCategory('human')).toBe(true)
    expect(isIncidentFactorCategory('unsafe')).toBe(false)
    expect(isIncidentFactorCategory(null)).toBe(false)
  })

  it('accepts only persisted preventative-step statuses', () => {
    expect(isIncidentPreventativeStepStatus('planned')).toBe(true)
    expect(isIncidentPreventativeStepStatus('completed')).toBe(true)
    expect(isIncidentPreventativeStepStatus('closed')).toBe(false)
    expect(isIncidentPreventativeStepStatus(undefined)).toBe(false)
  })
})
