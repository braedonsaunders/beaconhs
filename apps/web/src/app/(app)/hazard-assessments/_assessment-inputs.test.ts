import { describe, expect, it } from 'vitest'
import {
  assessmentRowOpKey,
  nullableText,
  parseAssessmentRowOp,
  parseQuestionAnswer,
  postedFlag,
  wireText,
} from './_assessment-inputs'

const ROW = '3f2c1d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f'

describe('hazard-assessment row op keys', () => {
  it('round-trips every inline child-row field', () => {
    for (const op of [
      { kind: 'hazards', rowId: ROW, field: 'applicable' },
      { kind: 'hazards', rowId: ROW, field: 'specificControls' },
      { kind: 'ppe', rowId: ROW, field: 'answer' },
      { kind: 'questions', rowId: ROW, field: 'answer' },
    ] as const) {
      expect(parseAssessmentRowOp(assessmentRowOpKey(op))).toEqual(op)
    }
  })

  it('leaves record fields and unknown keys to the column ops', () => {
    for (const key of [
      'siteOrgUnitId',
      'jobScope',
      `hazards:${ROW}:preLikelihood`,
      `ppe:${ROW}:name`,
      `questions:${ROW}:question`,
      `tasks:${ROW}:controls`,
      'hazards:not-a-uuid:applicable',
      `hazards:${ROW}:applicable:extra`,
      `toString:${ROW}:answer`,
    ]) {
      expect(parseAssessmentRowOp(key)).toBeNull()
    }
  })
})

describe('hazard-assessment input rules', () => {
  it('trims optional text and clears blanks', () => {
    expect(nullableText('  Lock out the panel  ')).toBe('Lock out the panel')
    expect(nullableText('   ')).toBeNull()
    expect(nullableText(null)).toBeNull()
  })

  it('reads posted and live switch values', () => {
    expect(postedFlag('on')).toBe(true)
    expect(postedFlag('true')).toBe(true)
    expect(postedFlag(true)).toBe(true)
    expect(postedFlag('false')).toBe(false)
    expect(postedFlag(null)).toBe(false)
  })

  it('accepts only text wire values', () => {
    expect(wireText('abc')).toBe('abc')
    expect(wireText(null)).toBe('')
    expect(() => wireText({ html: 'x' })).toThrow('This value is invalid.')
  })

  it('takes Yes / No answers and listed options, and any free text', () => {
    const yesNo = { questionType: 'yes_no' as const, answers: [] }
    expect(parseQuestionAnswer(yesNo, 'N/A')).toBe('N/A')
    expect(parseQuestionAnswer(yesNo, '')).toBeNull()
    expect(() => parseQuestionAnswer(yesNo, 'Maybe')).toThrow('Answer is invalid.')

    const choice = { questionType: 'multi_select' as const, answers: ['North gate', 'South gate'] }
    expect(parseQuestionAnswer(choice, ' South gate ')).toBe('South gate')
    expect(() => parseQuestionAnswer(choice, 'East gate')).toThrow('Answer is invalid.')

    const text = { questionType: 'text' as const, answers: [] }
    expect(parseQuestionAnswer(text, '  Crane on site  ')).toBe('Crane on site')
    expect(() => parseQuestionAnswer(text, 42)).toThrow('Answer is invalid.')
  })
})
