import { describe, expect, it } from 'vitest'
import {
  assertSkillAssignmentDateOrder,
  parseRevocationReason,
  parseSkillAssignmentFieldUpdate,
  parseSkillFileInput,
} from './_mutation-input'

const ASSIGNMENT_ID = '10000000-0000-4000-8000-000000000001'
const ATTACHMENT_ID = '20000000-0000-4000-8000-000000000001'

describe('training skill mutation input', () => {
  it('strictly validates assignment fields and date ranges', () => {
    expect(parseSkillAssignmentFieldUpdate('personId', ASSIGNMENT_ID)).toEqual({
      field: 'personId',
      value: ASSIGNMENT_ID,
    })
    expect(parseSkillAssignmentFieldUpdate('expiresOn', '')).toEqual({
      field: 'expiresOn',
      value: null,
    })
    expect(() => parseSkillAssignmentFieldUpdate('grantedOn', '2026-02-29')).toThrow()
    expect(() => parseSkillAssignmentFieldUpdate('notes', 'x'.repeat(10_001))).toThrow(/too long/)
    expect(() => assertSkillAssignmentDateOrder('2026-05-02', '2026-05-01')).toThrow(
      /cannot be before/,
    )
  })

  it('requires exact file identifiers, kinds, and bounded labels', () => {
    expect(
      parseSkillFileInput({
        assignmentId: ASSIGNMENT_ID,
        attachmentId: ATTACHMENT_ID,
        label: '  First Aid card  ',
        kind: 'certificate',
      }),
    ).toEqual({
      assignmentId: ASSIGNMENT_ID,
      attachmentId: ATTACHMENT_ID,
      label: 'First Aid card',
      kind: 'certificate',
    })
    expect(() =>
      parseSkillFileInput({
        assignmentId: ASSIGNMENT_ID,
        attachmentId: ATTACHMENT_ID,
        label: 'Card',
        kind: 'unknown',
      }),
    ).toThrow(/File kind is invalid/)
    expect(() =>
      parseSkillFileInput({
        assignmentId: ASSIGNMENT_ID,
        attachmentId: 'not-a-uuid',
        label: 'Card',
        kind: 'other',
      }),
    ).toThrow(/Attachment is invalid/)
  })

  it('bounds optional revocation reasons without fabricating one', () => {
    expect(parseRevocationReason(null)).toBeNull()
    expect(parseRevocationReason('  superseded  ')).toBe('superseded')
    expect(() => parseRevocationReason('x'.repeat(1_001))).toThrow(/too long/)
    expect(() => parseRevocationReason(new Blob())).toThrow(/invalid/)
  })
})
