import { describe, expect, it } from 'vitest'
import type { FormSchemaV1 } from '@beaconhs/forms-core'
import { computeFormScore } from './score-router'

function schemaWith(
  sections: FormSchemaV1['sections'],
  scoreRouting?: NonNullable<FormSchemaV1['workflow']>['scoreRouting'],
): FormSchemaV1 {
  return {
    schemaVersion: 1,
    title: { en: 'Score routing test' },
    sections,
    workflow: {
      steps: [
        {
          key: 'submit',
          title: { en: 'Submit' },
          assignee: { type: 'role', role: 'worker' },
        },
      ],
      scoreRouting,
    },
  }
}

describe('computeFormScore', () => {
  it('includes every answered repeating row in default scoring', () => {
    const schema = schemaWith([
      {
        id: 'summary',
        fields: [{ id: 'overall', type: 'pass_fail_na', label: { en: 'Overall' } }],
      },
      {
        id: 'checks',
        repeating: true,
        fields: [{ id: 'result', type: 'pass_fail_na', label: { en: 'Result' } }],
      },
    ])

    expect(
      computeFormScore(
        schema,
        { overall: 'pass', checks: [{ result: 'pass' }, { result: 'fail' }] },
        { checks: [{ result: 'pass' }, { result: 'fail' }] },
      ),
    ).toEqual({ score: 66.67, failedFieldKeys: ['result'], status: 'non_compliant' })
  })

  it('reports a repeated failed field once while counting every failed answer', () => {
    const schema = schemaWith([
      {
        id: 'checks',
        repeating: true,
        fields: [{ id: 'result', type: 'pass_fail_na', label: { en: 'Result' } }],
      },
    ])

    expect(
      computeFormScore(
        schema,
        { checks: [{ result: 'pass' }, { result: 'fail' }, { result: 'fail' }] },
        { checks: [{ result: 'pass' }, { result: 'fail' }, { result: 'fail' }] },
      ),
    ).toEqual({ score: 33.33, failedFieldKeys: ['result'], status: 'non_compliant' })
  })

  it('applies hard-fail rules to compound answers inside repeating rows', () => {
    const schema = schemaWith(
      [
        {
          id: 'checks',
          repeating: true,
          fields: [
            {
              id: 'accepted',
              type: 'yes_no_comment',
              label: { en: 'Accepted' },
            },
          ],
        },
      ],
      {
        hardFailRules: [{ kind: 'any_field_in', fieldKeys: ['accepted'], values: ['no', 'fail'] }],
      },
    )

    expect(
      computeFormScore(
        schema,
        { checks: [{ accepted: { answer: 'yes' } }, { accepted: { answer: 'no' } }] },
        { checks: [{ accepted: { answer: 'yes' } }, { accepted: { answer: 'no' } }] },
      ),
    ).toEqual({ score: 50, failedFieldKeys: ['accepted'], status: 'non_compliant' })
  })

  it('keeps an unscored form pending review', () => {
    const schema = schemaWith([
      {
        id: 'notes',
        fields: [{ id: 'note', type: 'text', label: { en: 'Note' } }],
      },
    ])

    expect(computeFormScore(schema, { note: 'Ready' }, {})).toEqual({
      score: 100,
      failedFieldKeys: [],
      status: 'pending_review',
    })
  })
})
