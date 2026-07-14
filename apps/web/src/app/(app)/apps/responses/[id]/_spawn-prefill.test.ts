import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { buildSpawnPrefill, displayValueForField } from './_spawn-prefill'

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Inspection' },
  sections: [
    {
      id: 'summary',
      fields: [{ id: 'overall', type: 'pass_fail_na', label: { en: 'Overall' } }],
    },
    {
      id: 'checks',
      repeating: true,
      fields: [{ id: 'result', type: 'yes_no_comment', label: { en: 'Accepted' } }],
    },
  ],
  workflow: {
    steps: [
      {
        key: 'submit',
        title: { en: 'Submit' },
        assignee: { type: 'role', role: 'worker' },
      },
    ],
  },
}

describe('failed-field display', () => {
  it('reads top-level response values', () => {
    expect(displayValueForField(schema, { overall: 'fail' }, 'overall')).toBe('fail')
  })

  it('labels and bounds values from repeating rows', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      result: { answer: index === 1 ? 'no' : 'yes', comment: index === 1 ? 'Guard missing' : '' },
    }))

    expect(displayValueForField(schema, { checks: rows }, 'result')).toBe(
      'Row 1: yes; Row 2: no — Guard missing; Row 3: yes; Row 4: yes; Row 5: yes; … (+2 more)',
    )
  })

  it('includes repeating-row evidence in corrective-action prefill', () => {
    const prefill = buildSpawnPrefill({
      templateName: 'Inspection',
      reference: 'abc123',
      score: 50,
      schema,
      values: {
        checks: [
          { result: { answer: 'yes' } },
          { result: { answer: 'no', comment: 'Guard missing' } },
        ],
      },
      failedFieldKeys: ['result'],
    })

    expect(prefill.caDescription).toContain('Accepted — Row 1: yes; Row 2: no — Guard missing')
  })
})
