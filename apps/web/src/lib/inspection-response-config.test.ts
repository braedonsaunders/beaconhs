import { describe, expect, it } from 'vitest'
import {
  inspectionCriterionIsAnswered,
  inspectionCriterionDisplayAnswer,
  normalizeInspectionChoiceOptions,
  normalizeInspectionNumberAnswer,
  normalizeInspectionTextAnswer,
  parseInspectionResponseConfig,
} from './inspection-response-config'

describe('inspection response config', () => {
  it('normalizes a bounded, ordered, unique choice list', () => {
    expect(
      normalizeInspectionChoiceOptions([' Safe ', '', 'Needs attention', 'Not observed']),
    ).toEqual(['Safe', 'Needs attention', 'Not observed'])
  })

  it('rejects incomplete, duplicate, oversized, and non-text choices', () => {
    expect(() => normalizeInspectionChoiceOptions(['Only one'])).toThrow(
      'require at least two options',
    )
    expect(() => normalizeInspectionChoiceOptions(['Safe', ' safe '])).toThrow('is duplicated')
    expect(() => normalizeInspectionChoiceOptions(['x'.repeat(201), 'Safe'])).toThrow(
      '200 characters or fewer',
    )
    expect(() => normalizeInspectionChoiceOptions(['Safe', 7])).toThrow(
      'Every choice option must be text',
    )
    expect(() =>
      normalizeInspectionChoiceOptions(Array.from({ length: 51 }, (_, i) => `O${i}`)),
    ).toThrow('up to 50 options')
  })

  it('keeps options only for choice questions and fails closed on unknown response types', () => {
    expect(parseInspectionResponseConfig('choice', ['A', 'B'])).toEqual({
      responseType: 'choice',
      choiceOptions: ['A', 'B'],
    })
    expect(parseInspectionResponseConfig('yes_no', ['ignored', 'values'])).toEqual({
      responseType: 'yes_no',
      choiceOptions: [],
    })
    expect(parseInspectionResponseConfig('long_text', ['ignored', 'values'])).toEqual({
      responseType: 'long_text',
      choiceOptions: [],
    })
    expect(parseInspectionResponseConfig('unknown', ['ignored', 'values'])).toEqual({
      responseType: 'pass_fail_na',
      choiceOptions: [],
    })
  })

  it('formats configured choices and existing outcome response kinds without conflating them', () => {
    expect(
      inspectionCriterionDisplayAnswer({
        responseType: 'choice',
        outcomeAnswer: null,
        choiceAnswer: 'Needs attention',
        textAnswer: null,
        numberAnswer: null,
      }),
    ).toBe('Needs attention')
    expect(
      inspectionCriterionDisplayAnswer({
        responseType: 'yes_no',
        outcomeAnswer: 'fail',
        choiceAnswer: null,
        textAnswer: null,
        numberAnswer: null,
      }),
    ).toBe('No')
    expect(
      inspectionCriterionDisplayAnswer({
        responseType: 'rating',
        outcomeAnswer: 'pass',
        choiceAnswer: null,
        textAnswer: null,
        numberAnswer: null,
      }),
    ).toBe('Pass')
    expect(
      inspectionCriterionDisplayAnswer({
        responseType: 'long_text',
        outcomeAnswer: null,
        choiceAnswer: null,
        textAnswer: 'Observed at the east gate',
        numberAnswer: null,
      }),
    ).toBe('Observed at the east gate')
    expect(
      inspectionCriterionDisplayAnswer({
        responseType: 'number',
        outcomeAnswer: null,
        choiceAnswer: null,
        textAnswer: null,
        numberAnswer: '12.500',
      }),
    ).toBe('12.500')
  })

  it('validates text and exact decimal input without JavaScript-number coercion', () => {
    expect(normalizeInspectionTextAnswer('  observation  ')).toBe('observation')
    expect(normalizeInspectionTextAnswer('   ')).toBeNull()
    expect(normalizeInspectionNumberAnswer(' 9007199254740993.0001 ')).toBe('9007199254740993.0001')
    expect(normalizeInspectionNumberAnswer('-1.25e3')).toBe('-1.25e3')
    expect(normalizeInspectionNumberAnswer('')).toBeNull()
    expect(() => normalizeInspectionNumberAnswer('12 metres')).toThrow('Enter a valid number')
  })

  it('determines completion from the column owned by each response kind', () => {
    const base = {
      outcomeAnswer: null,
      choiceAnswer: null,
      textAnswer: null,
      numberAnswer: null,
    } as const
    expect(
      inspectionCriterionIsAnswered({ ...base, responseType: 'text', textAnswer: 'Done' }),
    ).toBe(true)
    expect(
      inspectionCriterionIsAnswered({ ...base, responseType: 'number', numberAnswer: '0' }),
    ).toBe(true)
    expect(inspectionCriterionIsAnswered({ ...base, responseType: 'number' })).toBe(false)
  })
})
