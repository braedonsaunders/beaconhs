import { describe, expect, it } from 'vitest'
import { parseAssessmentQuestionChoices } from './assessment-question-input'

const OPTIONS = JSON.stringify([
  { value: 'first', label: 'First choice' },
  { value: 'second', label: 'Second choice' },
  { value: 'third', label: 'Third choice' },
])

describe('parseAssessmentQuestionChoices', () => {
  it('keeps structured choices and validates a single correct answer', () => {
    expect(parseAssessmentQuestionChoices('single_choice', OPTIONS, 'second')).toEqual({
      options: [
        { value: 'first', label: 'First choice' },
        { value: 'second', label: 'Second choice' },
        { value: 'third', label: 'Third choice' },
      ],
      correctAnswer: 'second',
    })
  })

  it('canonicalizes multiple correct answers in choice order', () => {
    expect(parseAssessmentQuestionChoices('multi_choice', OPTIONS, 'third,first,third')).toEqual({
      options: [
        { value: 'first', label: 'First choice' },
        { value: 'second', label: 'Second choice' },
        { value: 'third', label: 'Third choice' },
      ],
      correctAnswer: 'first,third',
    })
  })

  it('rejects missing, duplicate, and unknown choices', () => {
    expect(() => parseAssessmentQuestionChoices('single_choice', '[]', '')).toThrow('at least two')
    expect(() =>
      parseAssessmentQuestionChoices(
        'single_choice',
        JSON.stringify([
          { value: 'a', label: 'Same' },
          { value: 'b', label: 'same' },
        ]),
        'a',
      ),
    ).toThrow('unique text')
    expect(() => parseAssessmentQuestionChoices('multi_choice', OPTIONS, 'missing')).toThrow(
      'does not match',
    )
  })

  it('requires a valid answer for numeric and true/false questions', () => {
    expect(parseAssessmentQuestionChoices('numeric', '', '2.5')).toEqual({
      options: null,
      correctAnswer: '2.5',
    })
    expect(() => parseAssessmentQuestionChoices('numeric', '', 'two')).toThrow('numeric')
    expect(() => parseAssessmentQuestionChoices('true_false', '', '')).toThrow('correct answer')
  })
})
