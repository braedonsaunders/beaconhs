import { describe, expect, it } from 'vitest'
import {
  ComplianceAudienceTargetError,
  planComplianceAudienceTargetLocks,
} from './audience-targets'

describe('compliance audience target lock plan', () => {
  it('deduplicates and sorts every persisted target kind deterministically', () => {
    expect(
      planComplianceAudienceTargetLocks([
        { kind: 'department', entityKey: '20000000-0000-4000-8000-000000000002' },
        { kind: 'person', entityKey: '10000000-0000-4000-8000-000000000002' },
        { kind: 'role', entityKey: 'worker' },
        { kind: 'department', entityKey: '20000000-0000-4000-8000-000000000001' },
        { kind: 'person', entityKey: '10000000-0000-4000-8000-000000000001' },
        { kind: 'department', entityKey: '20000000-0000-4000-8000-000000000002' },
        { kind: 'trade', entityKey: '30000000-0000-4000-8000-000000000001' },
        { kind: 'org_unit', entityKey: '40000000-0000-4000-8000-000000000001' },
        { kind: 'everyone', entityKey: '' },
      ]),
    ).toEqual({
      everyone: [''],
      person: ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'],
      role: ['worker'],
      trade: ['30000000-0000-4000-8000-000000000001'],
      department: ['20000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000002'],
      org_unit: ['40000000-0000-4000-8000-000000000001'],
    })
  })

  it('rejects malformed polymorphic references before touching the database', () => {
    expect(() =>
      planComplianceAudienceTargetLocks([{ kind: 'everyone', entityKey: 'unexpected' }]),
    ).toThrow(ComplianceAudienceTargetError)
    expect(() =>
      planComplianceAudienceTargetLocks([{ kind: 'department', entityKey: '   ' }]),
    ).toThrow(ComplianceAudienceTargetError)
    expect(() =>
      planComplianceAudienceTargetLocks([{ kind: 'person', entityKey: 'not-a-uuid' }]),
    ).toThrow(ComplianceAudienceTargetError)
  })

  it('normalizes the audience-picker everyone sentinel to the persisted empty key', () => {
    expect(
      planComplianceAudienceTargetLocks([
        { kind: 'everyone', entityKey: ' all ' },
        { kind: 'everyone', entityKey: '' },
      ]),
    ).toMatchObject({ everyone: [''] })
  })
})
