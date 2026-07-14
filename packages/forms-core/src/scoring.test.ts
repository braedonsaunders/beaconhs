import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from './schema'
import { extractScores } from './scoring'

const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Scoring test' },
  sections: [
    {
      id: 'summary',
      fields: [{ id: 'status', type: 'traffic_light', label: { en: 'Status' } }],
    },
    {
      id: 'checks',
      repeating: true,
      fields: [
        { id: 'result', type: 'pass_fail_na', label: { en: 'Result' } },
        { id: 'rating', type: 'rating', label: { en: 'Rating' }, config: { max: 5 } },
      ],
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

describe('extractScores', () => {
  it('materializes every repeating score and uses integer traffic-light values', () => {
    expect(
      extractScores(schema, {
        status: 'yellow',
        checks: [
          { result: 'pass', rating: 5 },
          { result: 'fail', rating: 2 },
        ],
      }),
    ).toEqual([
      { fieldId: 'status', sectionId: 'summary', score: 1, label: 'yellow', weight: 1 },
      { fieldId: 'result', sectionId: 'checks', score: 1, label: 'pass', weight: 1 },
      { fieldId: 'result', sectionId: 'checks', score: 0, label: 'fail', weight: 1 },
      { fieldId: 'rating', sectionId: 'checks', score: 5, label: 'rating:5', weight: 1 },
      { fieldId: 'rating', sectionId: 'checks', score: 2, label: 'rating:2', weight: 1 },
    ])
  })

  it('falls back to a safe weight when historical input bypasses schema validation', () => {
    const invalidWeightSchema: FormSchemaV1 = {
      ...schema,
      sections: [
        {
          id: 'summary',
          fields: [
            {
              id: 'status',
              type: 'traffic_light',
              label: { en: 'Status' },
              config: { weight: Number.POSITIVE_INFINITY },
            },
          ],
        },
      ],
    }

    expect(extractScores(invalidWeightSchema, { status: 'green' })).toEqual([
      { fieldId: 'status', sectionId: 'summary', score: 2, label: 'green', weight: 1 },
    ])
  })
})
