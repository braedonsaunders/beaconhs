import { describe, expect, it } from 'vitest'
import type { Database } from '@beaconhs/db'
import {
  assertComplianceTargetCanRetire,
  ComplianceTargetInUseError,
  planComplianceTargetRetirement,
} from './target-retirement'

function databaseReturning(rows: { id: string }[]): Database {
  const query = {
    from: () => query,
    where: () => query,
    limit: () => query,
    for: async () => rows,
  }
  return { select: () => query } as unknown as Database
}

describe('planComplianceTargetRetirement', () => {
  it.each([
    ['inspection_type', ['inspection'], 'inspectionTypeId'],
    ['document', ['document'], 'documentId'],
    ['assessment_type', ['training'], 'assessmentTypeId'],
    ['skill_type', ['cert_requirement'], 'skillTypeId'],
    ['form_template', ['form'], 'formTemplateId'],
    ['equipment_type', ['equipment_inspection'], 'equipmentTypeId'],
    ['ppe_type', ['ppe_inspection'], 'ppeTypeId'],
  ] as const)('maps %s to its sole producer and target key', (target, modules, key) => {
    const plan = planComplianceTargetRetirement(target)
    expect(plan.sourceModules).toEqual(modules)
    expect(plan.targetRefKey).toBe(key)
  })

  it('covers both course-producing obligation families', () => {
    expect(planComplianceTargetRetirement('course')).toMatchObject({
      sourceModules: ['training', 'cert_requirement'],
      targetRefKey: 'courseId',
    })
  })

  it('allows an unreferenced target to retire', async () => {
    await expect(
      assertComplianceTargetCanRetire(
        databaseReturning([]),
        '00000000-0000-4000-8000-000000000001',
        'ppe_type',
        '00000000-0000-4000-8000-000000000002',
      ),
    ).resolves.toBeUndefined()
  })

  it('returns a typed, actionable error for a referenced target', async () => {
    await expect(
      assertComplianceTargetCanRetire(
        databaseReturning([{ id: '00000000-0000-4000-8000-000000000003' }]),
        '00000000-0000-4000-8000-000000000001',
        'assessment_type',
        '00000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toEqual(
      new ComplianceTargetInUseError(
        'Cannot retire this assessment type while an active compliance obligation requires it. Pause or delete the obligation first.',
      ),
    )
  })
})
