import { describe, expect, it } from 'vitest'
import { parseObligationInput, type ObligationInput } from './_input'

function validInput(overrides: Partial<ObligationInput> = {}): ObligationInput {
  return {
    kind: 'document',
    title: 'Read the policy',
    audience: [{ type: 'everyone', entityKey: 'all' }],
    recurrence: { kind: 'one_time' },
    documentId: '10000000-0000-4000-8000-000000000001',
    ...overrides,
  }
}

describe('parseObligationInput', () => {
  it('accepts rolling document reviews, edition reminders, and wrapped seasonal periods', () => {
    expect(
      parseObligationInput(
        validInput({
          recurrence: {
            kind: 'frequency',
            frequency: 'year',
            evidenceWindow: 'rolling',
            activeMonths: { from: 11, to: 3 },
          },
        }),
      ).ok,
    ).toBe(true)
    expect(
      parseObligationInput(
        validInput({
          recurrence: {
            kind: 'frequency',
            frequency: 'year',
            reacknowledgeOnEdition: true,
            newEditionDueDays: 30,
          },
        }),
      ).ok,
    ).toBe(true)
    expect(
      parseObligationInput(
        validInput({
          recurrence: {
            kind: 'frequency',
            frequency: 'year',
            activeMonths: { from: 0, to: 13 },
          },
        }),
      ).ok,
    ).toBe(false)
  })

  it('normalizes the everyone sentinel and duplicate audience rows', () => {
    const result = parseObligationInput(
      validInput({
        audience: [
          { type: 'everyone', entityKey: 'all' },
          { type: 'everyone', entityKey: '' },
        ],
      }),
    )
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        audience: [{ type: 'everyone', entityKey: '', excluded: false }],
      }),
    })
  })

  it('rejects malformed identifiers, dates, and unknown properties', () => {
    expect(parseObligationInput(validInput({ documentId: 'not-a-uuid' })).ok).toBe(false)
    expect(
      parseObligationInput(validInput({ recurrence: { kind: 'one_time', dueOn: '2026-02-30' } }))
        .ok,
    ).toBe(false)
    expect(parseObligationInput({ ...validInput(), unexpected: true }).ok).toBe(false)
  })

  it('enforces the audience kinds supported by each obligation adapter', () => {
    const result = parseObligationInput(
      validInput({ kind: 'form', formTemplateId: '10000000-0000-4000-8000-000000000002' }),
    )
    expect(result).toEqual({
      ok: false,
      error: 'everyone is not valid for this obligation',
    })
  })

  it('rejects forged audiences on per-record and per-task obligations', () => {
    const result = parseObligationInput(
      validInput({
        kind: 'job_title_signoff',
        jobTitleId: '10000000-0000-4000-8000-000000000003',
      }),
    )
    expect(result).toEqual({
      ok: false,
      error: 'This obligation kind does not accept an audience',
    })
  })
})

it('preserves independent include and exclude targets, and rejects rolling activity rules', () => {
  const entityKey = '10000000-0000-4000-8000-000000000001'
  const parsed = parseObligationInput(
    validInput({
      audience: [
        { type: 'person', entityKey },
        { type: 'person', entityKey, excluded: true },
        { type: 'person', entityKey, excluded: true },
      ],
    }),
  )
  expect(parsed).toMatchObject({
    ok: true,
    value: {
      audience: [
        { type: 'person', entityKey, excluded: false },
        { type: 'person', entityKey, excluded: true },
      ],
    },
  })
  expect(
    parseObligationInput(
      validInput({
        kind: 'journal',
        recurrence: { kind: 'frequency', frequency: 'year', evidenceWindow: 'rolling' },
      }),
    ).ok,
  ).toBe(false)
})

it('defaults new people obligations to employees and validates worker-type selections', () => {
  expect(parseObligationInput(validInput())).toEqual({
    ok: true,
    value: expect.objectContaining({ workerType: 'employee' }),
  })
  for (const workerType of ['employee', 'contractor', 'all'] as const)
    expect(parseObligationInput(validInput({ workerType }))).toEqual({
      ok: true,
      value: expect.objectContaining({ workerType }),
    })
  expect(parseObligationInput({ ...validInput(), workerType: 'visitor' }).ok).toBe(false)
  expect(
    parseObligationInput(
      validInput({
        kind: 'ppe_inspection',
        ppeTypeId: '10000000-0000-4000-8000-000000000003',
        audience: [],
      }),
    ),
  ).toEqual({ ok: true, value: expect.objectContaining({ workerType: 'all' }) })
})

it('rejects equipment policy authoring through Compliance', () => {
  expect(
    parseObligationInput({
      ...validInput(),
      kind: 'equipment_inspection',
      equipmentTypeId: '10000000-0000-4000-8000-000000000003',
      audience: [],
    }).ok,
  ).toBe(false)
})
