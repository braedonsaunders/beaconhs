import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@beaconhs/db'
import type { RequestContext } from '@beaconhs/tenant'
import { correctiveActions, caCompleteSteps } from '@beaconhs/db/schema'
import {
  resolveCorrectiveActionInTx,
  resumeCorrectiveActionInTx,
} from './corrective-action-resolution'

const mocks = vi.hoisted(() => ({
  canSee: vi.fn(),
  assertCan: vi.fn(),
  audit: vi.fn(),
  event: vi.fn(),
  materialize: vi.fn(),
}))
vi.mock('@beaconhs/tenant', () => ({ assertCan: mocks.assertCan }))
vi.mock('./visibility', () => ({ canSeeRecord: mocks.canSee }))
vi.mock('./audit', () => ({ recordAuditInTransaction: mocks.audit }))
vi.mock('@beaconhs/compliance', () => ({ materializeEvidenceTargetObligations: mocks.materialize }))
vi.mock('@beaconhs/events', () => ({
  recordDomainEvent: mocks.event,
  moduleFlowCommand: (_ctx: unknown, input: unknown) => input,
}))
vi.mock('@beaconhs/integrations', () => ({
  correctiveActionClosedEvent: (_tenant: unknown, input: unknown) => input,
}))

const ctx = { tenantId: 'tenant-a', membership: { id: 'member-a' } } as RequestContext
function database(overrides: Record<string, unknown> = {}) {
  const ca = {
    id: 'action-a',
    reference: 'CA-1',
    title: 'Eye protection',
    severity: 'low',
    status: 'open',
    locked: false,
    verificationRequired: false,
    verifiedAt: null,
    closedAt: null,
    ownerTenantUserId: 'member-a',
    siteOrgUnitId: null,
    ...overrides,
  }
  const updates: unknown[] = [],
    steps: unknown[] = []
  let locks = 0
  const tx = {
    select: () => {
      let rows: unknown[] = []
      const query = {
        from: (table: unknown) => {
          rows = table === correctiveActions ? [ca] : [{ n: 1 }]
          return query
        },
        where: () => query,
        limit: () => query,
        for: () => {
          locks++
          return query
        },
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      }
      return query
    },
    update: () => ({
      set: (patch: object) => ({
        where: async () => {
          updates.push(patch)
          Object.assign(ca, patch)
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (value: unknown) => {
        expect(table).toBe(caCompleteSteps)
        steps.push(value)
      },
    }),
  } as unknown as Database
  return { tx, ca, updates, steps, locks: () => locks }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.canSee.mockResolvedValue(true)
  mocks.assertCan.mockImplementation(() => {})
})

describe('atomic corrective action resolution', () => {
  it('closes and locks, records evidence and one lifecycle event, and refreshes compliance', async () => {
    const db = database()
    expect(
      await resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', { notes: 'Glasses supplied.' }),
    ).toEqual({ ok: true })
    expect(db.ca).toMatchObject({ status: 'closed', locked: true, closedAt: expect.any(Date) })
    expect(db.steps).toEqual([
      expect.objectContaining({
        description: 'Glasses supplied.',
        completedByTenantUserId: 'member-a',
      }),
    ])
    expect(db.locks()).toBe(1)
    expect(mocks.assertCan).toHaveBeenCalledWith(ctx, 'ca.update')
    expect(mocks.event).toHaveBeenCalledWith(
      db.tx,
      expect.objectContaining({ eventType: 'corrective_action.closed' }),
    )
    expect(mocks.audit).toHaveBeenCalledTimes(1)
    expect(mocks.materialize).toHaveBeenCalledTimes(1)
    expect((await resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', {})).ok).toBe(false)
    expect(db.updates).toHaveLength(1)
  })
  it('requires verification instead of manufacturing a sign-off', async () => {
    const db = database({ verificationRequired: true })
    expect((await resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', {})).ok).toBe(false)
    expect(db.updates).toHaveLength(0)
    expect(
      await resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', {
        allowPendingVerification: true,
        notes: 'Tags delivered.',
      }),
    ).toEqual({ ok: true })
    expect(db.ca).toMatchObject({
      status: 'pending_verification',
      locked: false,
      verifiedAt: null,
      closedAt: null,
    })
    expect(mocks.event.mock.calls[0]?.[1].payload.notification).toBeUndefined()
    await resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', { allowPendingVerification: true })
    expect(db.updates).toHaveLength(1)
    expect(db.steps).toHaveLength(1)
  })
  it('allows an already verified action to close', async () => {
    const db = database({ verificationRequired: true, verifiedAt: new Date() })
    await resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', { allowPendingVerification: true })
    expect(db.ca.status).toBe('closed')
  })
  it.each([{ status: 'closed' }, { status: 'cancelled' }, { locked: true }])(
    'preserves immutable history: %s',
    async (state) => {
      const db = database(state)
      expect((await resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', {})).ok).toBe(false)
      expect(db.updates).toHaveLength(0)
    },
  )
  it('checks action permission and record scope before writing', async () => {
    const db = database()
    mocks.assertCan.mockImplementationOnce(() => {
      throw new Error('Forbidden')
    })
    await expect(resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', {})).rejects.toThrow(
      'Forbidden',
    )
    mocks.canSee.mockResolvedValue(false)
    expect((await resolveCorrectiveActionInTx(db.tx, ctx, 'action-a', {})).ok).toBe(false)
    expect(db.updates).toHaveLength(0)
  })
  it('resumes follow-up and clears obsolete completion and verification stamps', async () => {
    const db = database({
      status: 'pending_verification',
      verifiedAt: new Date(),
      closedAt: new Date(),
    })
    expect(await resumeCorrectiveActionInTx(db.tx, ctx, 'action-a')).toEqual({ ok: true })
    expect(db.ca).toMatchObject({
      status: 'in_progress',
      closedAt: null,
      verifiedAt: null,
      verifiedByTenantUserId: null,
    })
    expect(mocks.event).toHaveBeenCalledWith(
      db.tx,
      expect.objectContaining({ eventType: 'corrective_action.reopened' }),
    )
  })
})
