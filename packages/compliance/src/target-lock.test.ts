import { describe, expect, it } from 'vitest'
import { ComplianceTargetError, planComplianceTargetLock } from './target-lock'

const id = '10000000-0000-4000-8000-000000000001'

describe('compliance target lock plan', () => {
  it('maps each polymorphic target to its lifecycle owner', () => {
    expect(planComplianceTargetLock('inspection', { inspectionTypeId: id })).toEqual({
      entity: 'inspection_type',
      id,
      label: 'inspection type',
    })
    expect(
      planComplianceTargetLock('training', {
        trainingItemKind: 'assessment_type',
        assessmentTypeId: id,
      }),
    ).toEqual({ entity: 'assessment_type', id, label: 'assessment type' })
    expect(planComplianceTargetLock('cert_requirement', { skillTypeId: id })).toEqual({
      entity: 'skill_type',
      id,
      label: 'skill type',
    })
    expect(planComplianceTargetLock('hazard_assessment', {})).toBeNull()
  })

  it('rejects missing, malformed, or ambiguous targets before querying', () => {
    expect(() => planComplianceTargetLock('document', {})).toThrow(ComplianceTargetError)
    expect(() => planComplianceTargetLock('document', { documentId: 'not-a-uuid' })).toThrow(
      'Pick a valid document',
    )
    expect(() =>
      planComplianceTargetLock('cert_requirement', { courseId: id, skillTypeId: id }),
    ).toThrow('ambiguous')
    expect(() =>
      planComplianceTargetLock('training', { courseId: id, assessmentTypeId: id }),
    ).toThrow('ambiguous')
  })
})
