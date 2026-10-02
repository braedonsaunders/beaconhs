import { describe, expect, it } from 'vitest'
import { formatAssessmentAnswer, assessmentOptionsText } from './assessment-display'
const options = [
  { value: 'isolate_energy', label: 'Isolate the energy source' },
  { value: 'start_work', label: 'Start work' },
]
describe('assessment answer presentation', () => {
  it('prints choice labels and all available options without value slugs', () => {
    expect(formatAssessmentAnswer('isolate_energy', 'single_choice', options)).toBe(
      'Isolate the energy source',
    )
    expect(formatAssessmentAnswer('isolate_energy,start_work', 'multi_choice', options)).toBe(
      'Isolate the energy source, Start work',
    )
    expect(assessmentOptionsText(options)).toBe('1. Isolate the energy source\n2. Start work')
  })
  it('formats booleans without altering free text or numerical answers', () => {
    expect(formatAssessmentAnswer('true', 'true_false', null)).toBe('True')
    expect(formatAssessmentAnswer('false', 'true_false', null)).toBe('False')
    expect(formatAssessmentAnswer('false', 'text', null)).toBe('false')
    expect(formatAssessmentAnswer('0', 'numeric', null)).toBe('0')
    expect(formatAssessmentAnswer(null, 'single_choice', options)).toBe('')
  })
})
