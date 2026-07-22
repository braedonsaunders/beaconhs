import { describe, expect, it } from 'vitest'
import {
  gradeAnswer,
  normalizeSubmittedAnswer,
  parseManualReviewNotes,
  parseManualReviewPoints,
} from './grading'

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

describe('manual review validation', () => {
  it('accepts whole-number points within the question maximum', () => {
    expect(parseManualReviewPoints('0', 3)).toBe(0)
    expect(parseManualReviewPoints('3', 3)).toBe(3)
  })

  it('rejects missing, fractional, and out-of-range points', () => {
    expect(() => parseManualReviewPoints(null, 3)).toThrow('whole-number')
    expect(() => parseManualReviewPoints('1.5', 3)).toThrow('whole-number')
    expect(() => parseManualReviewPoints('4', 3)).toThrow('between 0 and 3')
  })

  it('trims optional notes and enforces the persisted limit', () => {
    expect(parseManualReviewNotes('  Good detail.  ')).toBe('Good detail.')
    expect(parseManualReviewNotes('  ')).toBeNull()
    expect(() => parseManualReviewNotes('x'.repeat(2_001))).toThrow('2,000')
  })
})
