import { describe, expect, it } from 'vitest'
import { buildBlankTrainingAssessmentHtml } from './training-assessment-blank-pdf'

const type = {
  name: 'Lift assessment',
  description: null,
  preAssessmentMessage: 'Read each question.',
}

describe('blank training assessment PDF', () => {
  it('prints every answer kind in order with writing space and no answer key', () => {
    const questions = [
      {
        prompt: 'Describe the hazard.',
        kind: 'text' as const,
        options: null,
        helpText: 'Use your own words.',
        mandatory: true,
      },
      {
        prompt: 'How many?',
        kind: 'numeric' as const,
        options: null,
        helpText: null,
        mandatory: true,
        correctAnswer: 'ANSWERS_MUST_NEVER_PRINT',
      },
      {
        prompt: 'Choose one.',
        kind: 'single_choice' as const,
        options: [
          { value: 'a', label: 'Choice A' },
          { value: 'b', label: 'Choice B' },
        ],
        helpText: null,
        mandatory: true,
      },
      {
        prompt: 'Choose several.',
        kind: 'multi_choice' as const,
        options: [
          { value: 'c', label: 'Choice C' },
          { value: 'd', label: 'Choice D' },
        ],
        helpText: null,
        mandatory: false,
      },
      {
        prompt: 'Is this safe?',
        kind: 'true_false' as const,
        options: null,
        helpText: null,
        mandatory: true,
      },
    ]
    const html = buildBlankTrainingAssessmentHtml(type, questions)
    for (const text of [
      'Name:',
      'Date:',
      'Signature:',
      'Choice A',
      'Choice B',
      'Choice C',
      'Choice D',
      'True',
      'False',
      'Use your own words.',
    ])
      expect(html).toContain(text)
    expect(html).not.toContain('ANSWERS_MUST_NEVER_PRINT')
    expect(html.indexOf('1. Describe')).toBeLessThan(html.indexOf('2. How many'))
    expect(html.indexOf('4. Choose several')).toBeLessThan(html.indexOf('5. Is this safe'))
    expect(html.match(/class="line"/g)).toHaveLength(5)
    expect(html).toContain('Select all that apply.')
  })

  it('escapes template text and option labels without running merge tokens', () => {
    const html = buildBlankTrainingAssessmentHtml(
      { ...type, name: '<script>evil()</script>', preAssessmentMessage: '{{answer}}' },
      [
        {
          prompt: '<img src=x onerror=evil()>',
          kind: 'single_choice',
          options: [{ value: 'a', label: '<iframe>secret</iframe>' }],
          helpText: null,
          mandatory: false,
        },
      ],
    )
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<iframe>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('{{answer}}')
  })
})
