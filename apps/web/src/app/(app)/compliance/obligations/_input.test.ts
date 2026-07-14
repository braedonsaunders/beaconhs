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
      value: expect.objectContaining({ audience: [{ type: 'everyone', entityKey: '' }] }),
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
