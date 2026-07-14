import { describe, expect, it } from 'vitest'
import { parseCorrectiveActionDraftInput, parseIncidentDraftInput } from './tools-write-policy'

type ParseResult = ReturnType<
  typeof parseCorrectiveActionDraftInput | typeof parseIncidentDraftInput
>

function expectError(result: ParseResult, expected: string): void {
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toContain(expected)
}

describe('assistant write-tool input boundaries', () => {
  it('rejects oversized remote text instead of silently truncating it', () => {
    expectError(
      parseIncidentDraftInput({
        title: 'x'.repeat(201),
        type: 'near_miss',
        severity: 'no_injury',
      }),
      'invalid_title: title must be 200 characters or fewer',
    )
    expectError(
      parseIncidentDraftInput({
        title: 'Valid incident',
        description: 'x'.repeat(4001),
        type: 'near_miss',
        severity: 'no_injury',
      }),
      'invalid_description: description must be 4,000 characters or fewer',
    )
    expectError(
      parseIncidentDraftInput({
        title: 'Valid incident',
        type: 'near_miss',
        severity: 'no_injury',
        location: 'x'.repeat(201),
      }),
      'invalid_location: location must be 200 characters or fewer',
    )
  })

  it('rejects invalid persisted dates instead of silently replacing them', () => {
    expectError(
      parseIncidentDraftInput({
        title: 'Valid incident',
        type: 'near_miss',
        severity: 'no_injury',
        occurredAt: 'not-a-date',
      }),
      'invalid_occurredAt: occurredAt must be a valid ISO datetime with a timezone',
    )
    expectError(
      parseIncidentDraftInput({
        title: 'Valid incident',
        type: 'near_miss',
        severity: 'no_injury',
        occurredAt: '2026-02-30T12:00:00Z',
      }),
      'invalid_occurredAt: occurredAt must be a valid ISO datetime with a timezone',
    )
    expectError(
      parseCorrectiveActionDraftInput({
        title: 'Valid corrective action',
        dueOn: '2026-02-30',
      }),
      'invalid_dueOn: dueOn must be a real calendar date in YYYY-MM-DD format',
    )
  })

  it('returns exact normalized incident values for signing and review', () => {
    const result = parseIncidentDraftInput({
      title: '  Forklift near miss  ',
      description: '  No contact occurred.  ',
      type: 'near_miss',
      severity: 'no_injury',
      occurredAt: '2026-07-13T12:30:00-04:00',
      location: '  North loading bay  ',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      title: 'Forklift near miss',
      description: 'No contact occurred.',
      type: 'near_miss',
      severity: 'no_injury',
      occurredAt: '2026-07-13T12:30:00-04:00',
      location: 'North loading bay',
    })
  })

  it('applies the same exact boundary to corrective-action proposals', () => {
    const result = parseCorrectiveActionDraftInput({
      title: '  Repair the handrail  ',
      description: '  Replace the damaged section.  ',
      dueOn: '2026-07-31',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toEqual({
      title: 'Repair the handrail',
      description: 'Replace the damaged section.',
      dueOn: '2026-07-31',
    })
  })
})
