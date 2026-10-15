import { inspectionCompliancePercent } from './inspection-response-config'
import { describe, expect, it } from 'vitest'
import {
  inspectionCriterionIsAnswered,
  inspectionCriterionDisplayAnswer,
  inspectionNumberAnswerWire,
  normalizeInspectionChoiceOptions,
  normalizeInspectionNumberAnswer,
  normalizeInspectionTextAnswer,
  parseInspectionNumberAnswer,
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

describe('inspection compliance percentage', () => {
  it('uses only pass/fail outcomes, independently of supplemental and N/A questions', () => {
    expect(inspectionCompliancePercent(22, 4)).toBe(85)
    expect(inspectionCompliancePercent(3, 0)).toBe(100)
    expect(inspectionCompliancePercent(0, 0)).toBe(0)
  })
})

describe('inspection number answer wire form', () => {
  it('spells every equal number one way, as PostgreSQL numeric would store it', () => {
    expect(inspectionNumberAnswerWire(null)).toBe('')
    expect(inspectionNumberAnswerWire('12.50')).toBe('12.5')
    expect(inspectionNumberAnswerWire('12.5')).toBe('12.5')
    expect(inspectionNumberAnswerWire('+012')).toBe('12')
    expect(inspectionNumberAnswerWire('.5')).toBe('0.5')
    expect(inspectionNumberAnswerWire('5.')).toBe('5')
    expect(inspectionNumberAnswerWire('1e3')).toBe('1000')
    expect(inspectionNumberAnswerWire('1.50e1')).toBe('15')
    expect(inspectionNumberAnswerWire('-2.5E-3')).toBe('-0.0025')
    expect(inspectionNumberAnswerWire('-0.000')).toBe('0')
    expect(inspectionNumberAnswerWire('0')).toBe('0')
  })

  it('keeps precision a JavaScript number would lose', () => {
    expect(inspectionNumberAnswerWire('12345678901234567890.123456789')).toBe(
      '12345678901234567890.123456789',
    )
  })

  it('refuses exponents a numeric column cannot hold', () => {
    expect(parseInspectionNumberAnswer('1e3')).toBe('1e3')
    expect(parseInspectionNumberAnswer(' ')).toBeNull()
    expect(() => parseInspectionNumberAnswer('1e99999')).toThrow('Enter a valid number')
    expect(() => parseInspectionNumberAnswer('abc')).toThrow('Enter a valid number')
  })
})
