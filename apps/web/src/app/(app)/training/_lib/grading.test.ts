import { describe, expect, it } from 'vitest'
import { gradeAnswer, normalizeSubmittedAnswer } from './grading'

const OPTIONS = [
  { value: 'one', label: 'One' },
  { value: 'two', label: 'Two' },
  { value: 'three', label: 'Three' },
]

describe('normalizeSubmittedAnswer', () => {
  it('records one selected radio option', () => {
    expect(normalizeSubmittedAnswer('single_choice', ['two'], OPTIONS, true)).toBe('two')
  })

  it('records selected checkboxes in stable option order', () => {
    expect(normalizeSubmittedAnswer('multi_choice', ['three', 'one'], OPTIONS, true)).toBe(
      'one,three',
    )
  })

  it('enforces required questions and rejects values outside the snapshot', () => {
    expect(() => normalizeSubmittedAnswer('multi_choice', [], OPTIONS, true)).toThrow('required')
    expect(normalizeSubmittedAnswer('multi_choice', [], OPTIONS, false)).toBeNull()
    expect(() => normalizeSubmittedAnswer('single_choice', ['missing'], OPTIONS, true)).toThrow(
      'available choices',
    )
  })
})

describe('gradeAnswer', () => {
  it('grades single and multiple choice answers', () => {
    expect(gradeAnswer('single_choice', 'two', 'two')).toBe(true)
    expect(gradeAnswer('multi_choice', 'one,three', 'three,one')).toBe(true)
    expect(gradeAnswer('multi_choice', 'one,three', 'one')).toBe(false)
  })
})
