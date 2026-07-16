import { describe, expect, it } from 'vitest'
import {
  buildHazidAppConfig,
  hazidAppIsApplicable,
  parseHazidAppConfig,
} from './hazid-app-condition'

describe('hazard assessment app conditions', () => {
  it('keeps an app unconditional when no condition is configured', () => {
    expect(hazidAppIsApplicable({}, new Map())).toBe(true)
  })

  it('shows an app only after its type question has the configured answer', () => {
    const config = buildHazidAppConfig('question-1', 'Yes')
    expect(hazidAppIsApplicable(config, new Map([['question-1', 'No']]))).toBe(false)
    expect(hazidAppIsApplicable(config, new Map([['question-1', 'yes']]))).toBe(true)
  })

  it('rejects partial conditions and ignores malformed stored JSON', () => {
    expect(() => buildHazidAppConfig('question-1', '')).toThrow(/both a question and the answer/)
    expect(parseHazidAppConfig({ condition: { questionId: 'question-1' } })).toEqual({})
  })
})
