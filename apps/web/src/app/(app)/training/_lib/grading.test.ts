import { describe, expect, it } from 'vitest'
import {
  draftAnswerWire,
  gradeAnswer,
  normalizeSubmittedAnswer,
  parseDraftAnswer,
  parseManualReviewNotes,
  parseManualReviewPoints,
  storedAnswerValues,
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

describe('in-progress answers', () => {
  it('stores each question kind exactly as a submission would', () => {
    expect(parseDraftAnswer('single_choice', 'two', OPTIONS)).toBe('two')
    expect(parseDraftAnswer('multi_choice', ['three', 'one'], OPTIONS)).toBe('one,three')
    expect(parseDraftAnswer('true_false', 'false', OPTIONS)).toBe('false')
    expect(parseDraftAnswer('numeric', ' 12.5 ', OPTIONS)).toBe('12.5')
    expect(parseDraftAnswer('text', '  Lock out the breaker.  ', OPTIONS)).toBe(
      'Lock out the breaker.',
    )
  })

  it('lets a question stay unanswered until submit', () => {
    expect(parseDraftAnswer('single_choice', '', OPTIONS)).toBeNull()
    expect(parseDraftAnswer('multi_choice', [], OPTIONS)).toBeNull()
    expect(parseDraftAnswer('text', '   ', OPTIONS)).toBeNull()
    expect(parseDraftAnswer('numeric', null, OPTIONS)).toBeNull()
  })

  it('refuses answers that do not fit the question', () => {
    expect(() => parseDraftAnswer('single_choice', 'missing', OPTIONS)).toThrow('available choices')
    expect(() => parseDraftAnswer('multi_choice', 'one', OPTIONS)).toThrow('available choices')
    expect(() => parseDraftAnswer('multi_choice', ['one', 7], OPTIONS)).toThrow('available choices')
    expect(() => parseDraftAnswer('true_false', 'maybe', OPTIONS)).toThrow('true or false')
    expect(() => parseDraftAnswer('numeric', 'twelve', OPTIONS)).toThrow('valid number')
    expect(() => parseDraftAnswer('text', ['a'], OPTIONS)).toThrow('invalid')
  })

  it('shows a stored answer in the form the page edits and resubmits it unchanged', () => {
    expect(draftAnswerWire('multi_choice', 'one,three')).toEqual(['one', 'three'])
    expect(draftAnswerWire('multi_choice', null)).toEqual([])
    expect(draftAnswerWire('single_choice', 'two')).toBe('two')
    expect(draftAnswerWire('text', null)).toBe('')
    // Text answers keep their commas.
    expect(storedAnswerValues('text', 'Gloves, glasses')).toEqual(['Gloves, glasses'])
    for (const [kind, stored] of [
      ['multi_choice', 'one,three'],
      ['single_choice', 'two'],
      ['text', 'Gloves, glasses'],
      ['numeric', '4'],
    ] as const) {
      expect(normalizeSubmittedAnswer(kind, storedAnswerValues(kind, stored), OPTIONS, true)).toBe(
        stored,
      )
      expect(parseDraftAnswer(kind, draftAnswerWire(kind, stored), OPTIONS)).toBe(stored)
    }
    expect(() =>
      normalizeSubmittedAnswer('text', storedAnswerValues('text', null), OPTIONS, true),
    ).toThrow('required')
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
