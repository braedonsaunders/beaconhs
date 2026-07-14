import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import type { Database } from '@beaconhs/db'
import {
  complianceObligations,
  documents,
  inspectionTypes,
  trainingCourses,
} from '@beaconhs/db/schema'

const mocks = vi.hoisted(() => ({
  ensureSystem: vi.fn(),
  materialize: vi.fn(),
  resolveClock: vi.fn(),
}))

vi.mock('./materialize', () => ({
  ensureSystemObligations: mocks.ensureSystem,
  materializeObligation: mocks.materialize,
  resolveComplianceClock: mocks.resolveClock,
}))

import {
  materializeEvidenceTargetObligations,
  materializeEvidenceTargetsObligations,
  planComplianceEvidenceTarget,
  type ComplianceEvidenceTarget,
} from './evidence'

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const TARGET_ID = '00000000-0000-4000-8000-000000000002'

function chain<T>(rows: T[], callbacks: { lock?: (mode: string) => void; order?: () => void }) {
  const query = Promise.resolve(rows) as Promise<T[]> & {
    where: (where: SQL) => unknown
    limit: () => unknown
    for: (mode: string) => unknown
    orderBy: () => unknown
  }
  query.where = () => query
  query.limit = () => query
  query.for = (mode: string) => {
    callbacks.lock?.(mode)
    return query
  }
  query.orderBy = () => {
    callbacks.order?.()
    return query
  }
  return query
}

function fakeDatabase(
  ownerTable: typeof documents | typeof inspectionTypes,
  obligations: Array<Record<string, unknown>>,
) {
  const events: string[] = []
  let obligationPredicate: SQL | null = null
  const tx = {
    select: vi.fn(() => ({
      from: (table: unknown) => {
        if (table === ownerTable) {
          const query = chain([{ id: TARGET_ID }], {
            lock: (mode) => events.push(`target-lock:${mode}`),
          })
          query.where = () => query
          return query
        }
        if (table === complianceObligations) {
          const query = chain(obligations, { order: () => events.push('obligation-order') })
          query.where = (where: SQL) => {
            obligationPredicate = where
            return query
          }
          return query
        }
        throw new Error('Unexpected evidence materialization table')
      },
    })),
  } as unknown as Database
  return { tx, events, obligationPredicate: () => obligationPredicate }
}

describe('evidence-target compliance materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureSystem.mockResolvedValue(undefined)
    mocks.resolveClock.mockResolvedValue({
      now: new Date('2026-07-14T12:00:00.000Z'),
      timezone: 'UTC',
    })
    mocks.materialize.mockImplementation(async (_tx, _tenantId, obligation) => ({
      obligation,
      result: { rows: [] },
      transitions: [],
      dispatchId: null,
      materialized: true,
    }))
  })

  it.each([
    {
      ownerTable: documents,
      target: { sourceModule: 'document', targetRef: { documentId: TARGET_ID } },
      jsonKey: 'documentId',
      owner: 'document',
    },
    {
      ownerTable: inspectionTypes,
      target: { sourceModule: 'inspection', targetRef: { inspectionTypeId: TARGET_ID } },
      jsonKey: 'inspectionTypeId',
      owner: 'inspection_type',
    },
  ] satisfies Array<{
    ownerTable: typeof documents | typeof inspectionTypes
    target: ComplianceEvidenceTarget
    jsonKey: string
    owner: 'document' | 'inspection_type'
  }>)(
    'locks the $target.sourceModule owner before selecting and materializing matching obligations',
    async ({ ownerTable, target, jsonKey, owner }) => {
      const obligations = [{ id: 'obligation-a' }, { id: 'obligation-b' }]
      const fake = fakeDatabase(ownerTable, obligations)
      mocks.materialize.mockImplementation(async (_tx, _tenantId, obligation) => {
        fake.events.push(`materialize:${String(obligation.id)}`)
        return { materialized: true }
      })

      await expect(
        materializeEvidenceTargetObligations(fake.tx, TENANT_ID, target),
      ).resolves.toEqual({ obligationIds: ['obligation-a', 'obligation-b'] })

      expect(planComplianceEvidenceTarget(target)).toEqual({
        owner,
        ownerId: TARGET_ID,
        matches: [{ sourceModule: target.sourceModule, targetKey: jsonKey }],
      })
      expect(fake.events).toEqual([
        'target-lock:update',
        'obligation-order',
        'materialize:obligation-a',
        'materialize:obligation-b',
      ])
      const predicate = new PgDialect().sqlToQuery(fake.obligationPredicate()!)
      expect(predicate.sql).toContain('"compliance_obligations"."tenant_id" = $1')
      expect(predicate.sql).toContain('"compliance_obligations"."status" = $2')
      expect(predicate.sql).toContain('"compliance_obligations"."source_module" = $3')
      expect(predicate.sql).toContain(`"compliance_obligations"."target_ref"->>'${jsonKey}' = $4`)
      expect(predicate.params).toEqual([TENANT_ID, 'active', target.sourceModule, TARGET_ID])
    },
  )

  it('plans every target-owned evidence family and fans courses out to both obligation kinds', () => {
    expect(
      planComplianceEvidenceTarget({
        sourceModule: 'training',
        targetRef: { courseId: TARGET_ID },
      }),
    ).toEqual({
      owner: 'course',
      ownerId: TARGET_ID,
      matches: [
        { sourceModule: 'training', targetKey: 'courseId' },
        { sourceModule: 'cert_requirement', targetKey: 'courseId' },
      ],
    })
    expect(
      planComplianceEvidenceTarget({
        sourceModule: 'training',
        targetRef: { assessmentTypeId: TARGET_ID },
      }),
    ).toMatchObject({
      owner: 'assessment_type',
      matches: [{ sourceModule: 'training', targetKey: 'assessmentTypeId' }],
    })
    expect(
      planComplianceEvidenceTarget({
        sourceModule: 'cert_requirement',
        targetRef: { skillTypeId: TARGET_ID },
      }),
    ).toMatchObject({
      owner: 'skill_type',
      matches: [{ sourceModule: 'cert_requirement', targetKey: 'skillTypeId' }],
    })
    expect(
      planComplianceEvidenceTarget({
        sourceModule: 'form',
        targetRef: { formTemplateId: TARGET_ID },
      }),
    ).toEqual({
      owner: 'form_template',
      ownerId: TARGET_ID,
      matches: [{ sourceModule: 'form', targetKey: 'formTemplateId' }],
    })
    expect(
      planComplianceEvidenceTarget({
        sourceModule: 'equipment_inspection',
        targetRef: { equipmentTypeId: TARGET_ID },
      }),
    ).toEqual({
      owner: 'equipment_type',
      ownerId: TARGET_ID,
      matches: [{ sourceModule: 'equipment_inspection', targetKey: 'equipmentTypeId' }],
    })
    expect(
      planComplianceEvidenceTarget({
        sourceModule: 'ppe_inspection',
        targetRef: { ppeTypeId: TARGET_ID },
      }),
    ).toEqual({
      owner: 'ppe_type',
      ownerId: TARGET_ID,
      matches: [{ sourceModule: 'ppe_inspection', targetKey: 'ppeTypeId' }],
    })
  })

  it.each(['journal', 'hazard_assessment', 'corrective_action'] as const)(
    'plans tenant-wide %s evidence without inventing a shadow target',
    (sourceModule) => {
      expect(planComplianceEvidenceTarget({ sourceModule, targetRef: {} })).toEqual({
        owner: null,
        ownerId: null,
        matches: [{ sourceModule, targetKey: null }],
      })
    },
  )

  it('provisions and materializes the built-in corrective-action obligation immediately', async () => {
    const obligations = [{ id: 'corrective-action-obligation' }]
    let predicate: SQL | null = null
    const tx = {
      select: vi.fn(() => ({
        from: (table: unknown) => {
          if (table !== complianceObligations) throw new Error('Unexpected corrective table')
          const query = chain(obligations, {})
          query.where = (where: SQL) => {
            predicate = where
            return query
          }
          return query
        },
      })),
    } as unknown as Database

    await expect(
      materializeEvidenceTargetObligations(tx, TENANT_ID, {
        sourceModule: 'corrective_action',
        targetRef: {},
      }),
    ).resolves.toEqual({ obligationIds: ['corrective-action-obligation'] })

    expect(mocks.ensureSystem).toHaveBeenCalledOnce()
    expect(mocks.ensureSystem).toHaveBeenCalledWith(tx, TENANT_ID)
    expect(mocks.materialize).toHaveBeenCalledOnce()
    const query = new PgDialect().sqlToQuery(predicate!)
    expect(query.sql).toContain('"compliance_obligations"."source_module" = $3')
    expect(query.params).toEqual([TENANT_ID, 'active', 'corrective_action'])
  })

  it('deduplicates and locks multiple evidence owners in deterministic order', async () => {
    const first = '00000000-0000-4000-8000-000000000010'
    const second = '00000000-0000-4000-8000-000000000020'
    const locked: string[] = []
    const tx = {
      select: vi.fn(() => ({
        from: (table: unknown) => {
          if (table === trainingCourses) {
            let ownerId = ''
            const query = chain([{ id: 'owner' }], {
              lock: () => locked.push(ownerId),
            })
            query.where = (where: SQL) => {
              ownerId = String(new PgDialect().sqlToQuery(where).params[1])
              return query
            }
            return query
          }
          if (table === complianceObligations) {
            return chain([], {})
          }
          throw new Error('Unexpected batch evidence table')
        },
      })),
    } as unknown as Database

    await materializeEvidenceTargetsObligations(tx, TENANT_ID, [
      { sourceModule: 'training', targetRef: { courseId: second } },
      { sourceModule: 'cert_requirement', targetRef: { courseId: first } },
      { sourceModule: 'training', targetRef: { courseId: second } },
    ])

    expect(locked).toEqual([first, second])
    expect(mocks.resolveClock).not.toHaveBeenCalled()
    expect(mocks.materialize).not.toHaveBeenCalled()
  })
})
