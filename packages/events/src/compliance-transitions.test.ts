import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

const mocks = vi.hoisted(() => ({
  obligationRows: [] as Array<Record<string, unknown>>,
  whereClause: null as SQL | null,
  enqueueEmail: vi.fn(),
  enqueueNotification: vi.fn(),
  categoryEnabled: vi.fn(),
  resolveAudience: vi.fn(),
}))

vi.mock('@beaconhs/db', () => ({
  db: {},
  withSuperAdmin: async (
    _db: unknown,
    run: (tx: {
      select: () => {
        from: () => {
          innerJoin: () => unknown
          where: (where: SQL) => { limit: () => Promise<Array<Record<string, unknown>>> }
        }
      }
    }) => Promise<unknown>,
  ) =>
    run({
      select: () => ({
        from: () => {
          const query = {
            innerJoin: () => query,
            where: (where: SQL) => {
              mocks.whereClause = where
              return query
            },
            limit: async () => mocks.obligationRows,
          }
          return query
        },
      }),
    }),
}))

vi.mock('@beaconhs/jobs', () => ({
  enqueueEmail: mocks.enqueueEmail,
  enqueueNotification: mocks.enqueueNotification,
}))

vi.mock('./recipients', () => ({
  isNotificationCategoryEnabled: mocks.categoryEnabled,
  resolveNotificationAudienceUserIds: mocks.resolveAudience,
}))

import { emitComplianceTransitions, type ComplianceTransitionEvent } from './index'

const overdueTransition: ComplianceTransitionEvent = {
  subjectKey: 'person-1',
  personId: null,
  userId: null,
  label: 'Worker One',
  to: 'overdue',
  dueOn: '2026-07-13',
}

describe('emitComplianceTransitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.obligationRows = []
    mocks.whereClause = null
    mocks.categoryEnabled.mockResolvedValue(true)
    mocks.resolveAudience.mockResolvedValue([])
  })

  it('refuses a dispatch when the live active obligation cannot be loaded', async () => {
    const emitted = await emitComplianceTransitions(
      'tenant-1',
      'obligation-1',
      [overdueTransition],
      'dispatch-1',
      'lease-1',
    )

    expect(emitted).toBe(false)
    expect(mocks.whereClause).not.toBeNull()
    const livePredicate = new PgDialect().sqlToQuery(mocks.whereClause!)
    expect(livePredicate.sql).toContain('"compliance_obligations"."tenant_id" = $1')
    expect(livePredicate.sql).toContain('"compliance_obligations"."id" = $2')
    expect(livePredicate.sql).toContain('"compliance_obligations"."status" = $3')
    expect(livePredicate.sql).toContain('"compliance_obligations"."deleted_at" is null')
    expect(livePredicate.sql).toContain('"compliance_dispatches"."status" = $7')
    expect(livePredicate.sql).toContain('"compliance_dispatches"."publish_lease_id" = $8')
    expect(livePredicate.params).toEqual([
      'tenant-1',
      'obligation-1',
      'active',
      'tenant-1',
      'dispatch-1',
      'obligation-1',
      'queued',
      'lease-1',
    ])
    expect(mocks.resolveAudience).not.toHaveBeenCalled()
    expect(mocks.enqueueNotification).not.toHaveBeenCalled()
    expect(mocks.enqueueEmail).not.toHaveBeenCalled()
  })

  it('does not acknowledge a live dispatch when it has no actionable transition', async () => {
    mocks.obligationRows = [
      {
        id: 'obligation-1',
        title: 'Orientation',
        sourceModule: 'training',
        targetRef: { courseId: 'course-1' },
      },
    ]

    const emitted = await emitComplianceTransitions(
      'tenant-1',
      'obligation-1',
      [{ ...overdueTransition, to: 'completed' }],
      'dispatch-1',
      'lease-1',
    )

    expect(emitted).toBe(false)
    expect(mocks.resolveAudience).not.toHaveBeenCalled()
    expect(mocks.enqueueNotification).not.toHaveBeenCalled()
    expect(mocks.enqueueEmail).not.toHaveBeenCalled()
  })

  it('acknowledges an actionable live dispatch even when no recipients resolve', async () => {
    mocks.obligationRows = [
      {
        id: 'obligation-1',
        title: 'Orientation',
        sourceModule: 'training',
        targetRef: { courseId: 'course-1' },
      },
    ]

    const emitted = await emitComplianceTransitions(
      'tenant-1',
      'obligation-1',
      [overdueTransition],
      'dispatch-1',
      'lease-1',
    )

    expect(emitted).toBe(true)
    expect(mocks.resolveAudience).toHaveBeenCalledTimes(1)
    expect(mocks.enqueueNotification).not.toHaveBeenCalled()
    expect(mocks.enqueueEmail).not.toHaveBeenCalled()
  })

  it('suppresses self-targeted compliance alerts when the tenant category is disabled', async () => {
    mocks.obligationRows = [
      {
        id: 'obligation-1',
        title: 'Weekly journal requirement',
        sourceModule: 'journal',
        targetRef: {},
      },
    ]
    mocks.categoryEnabled.mockResolvedValue(false)

    const emitted = await emitComplianceTransitions(
      'tenant-1',
      'obligation-1',
      [{ ...overdueTransition, userId: 'user-1' }],
      'dispatch-1',
      'lease-1',
    )

    expect(emitted).toBe(false)
    expect(mocks.categoryEnabled).toHaveBeenCalledTimes(1)
    expect(mocks.resolveAudience).not.toHaveBeenCalled()
    expect(mocks.enqueueNotification).not.toHaveBeenCalled()
    expect(mocks.enqueueEmail).not.toHaveBeenCalled()
  })
})
