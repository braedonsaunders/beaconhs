import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  canSeeRecord: vi.fn(async () => true),
  materialize: vi.fn(async () => undefined),
  recordDomainEvent: vi.fn(async () => undefined),
  recordAuditInTransaction: vi.fn(async () => undefined),
}))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@beaconhs/tenant/visibility', () => ({ canSeeRecord: mocks.canSeeRecord }))
vi.mock('@beaconhs/compliance', () => ({
  materializeEvidenceTargetObligations: mocks.materialize,
}))
vi.mock('@beaconhs/events', () => ({ recordDomainEvent: mocks.recordDomainEvent }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: mocks.recordAuditInTransaction }))

import type { Database } from '@beaconhs/db'
import { correctiveActions, orgUnits, tenantUsers } from '@beaconhs/db/schema'
import type { RequestContext } from '@beaconhs/tenant'
import { correctiveActionRecordSaver } from './_record-edits'

const CA_ID = '5b0f3c3e-2f7a-4d6e-9a51-0c6f4c1b2d3e'
const OWNER_ID = '0d4e8a1f-6c2b-4b7a-8f3e-9a1c2d3e4f50'
const SITE_ID = '7e2a9c4b-1d3f-4a6e-b8c0-2f4e6a8c0b1d'

type Row = typeof correctiveActions.$inferSelect

function caRow(overrides: Partial<Row> = {}): Row {
  return {
    id: CA_ID,
    tenantId: 'tenant-1',
    reference: 'CA-2026-0001',
    flowExecutionKey: null,
    title: 'Guard rail missing',
    description: null,
    severity: 'medium',
    status: 'open',
    isDraft: false,
    assignedByTenantUserId: null,
    ownerTenantUserId: null,
    siteOrgUnitId: null,
    assignedOn: '2026-10-01',
    dueOn: null,
    rootCause: null,
    actionTaken: null,
    source: null,
    sourceEntityType: null,
    sourceEntityId: null,
    sourceFormResponseId: null,
    verificationRequired: false,
    verificationNotes: null,
    verifiedByTenantUserId: null,
    verifiedAt: null,
    costImpact: null,
    closedAt: null,
    locked: false,
    metadata: {},
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    deletedAt: null,
    ...overrides,
  }
}

/** A query builder whose every step is chainable and awaitable. */
function query<T>(result: () => T) {
  const chain: Record<string, unknown> = {}
  for (const step of ['from', 'where', 'limit', 'for', 'set']) chain[step] = () => chain
  chain.then = (resolve: (value: T) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve().then(result).then(resolve, reject)
  return chain
}

function harness(row: Row, options: { activeOwners?: string[]; sites?: string[] } = {}) {
  const writes: Array<Record<string, unknown>> = []
  const tx = {
    execute: async () => undefined,
    select: () => {
      let table: unknown
      const chain = query(() => {
        if (table === correctiveActions) return [row]
        if (table === tenantUsers) return (options.activeOwners ?? []).map((id) => ({ id }))
        if (table === orgUnits) return (options.sites ?? []).map((id) => ({ id }))
        throw new Error('unexpected table')
      })
      return {
        ...chain,
        from: (from: unknown) => {
          table = from
          return chain
        },
      }
    },
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        writes.push(patch)
        return query(() => undefined)
      },
    }),
  } as unknown as Database
  const ctx = {
    tenantId: 'tenant-1',
    timezone: 'America/Toronto',
    isSuperAdmin: false,
    permissions: new Set(['ca.update']),
    db: <T>(fn: (db: Database) => Promise<T>) => fn(tx),
  } as unknown as RequestContext
  return { ctx, writes }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.canSeeRecord.mockImplementation(async () => true)
})

describe('corrective action record saver', () => {
  it('stores cost impact in cents and refuses what the Close drawer refuses', async () => {
    const { ctx, writes } = harness(caRow({ costImpact: '12.50' }))
    const result = await correctiveActionRecordSaver(ctx, CA_ID, [
      { fieldId: 'costImpact', value: '99.5', base: '12.5' },
    ])
    expect(result).toMatchObject({ ok: true, applied: [{ fieldId: 'costImpact', stored: '99.5' }] })
    expect(writes).toEqual([{ costImpact: '99.5' }])

    for (const [value, error] of [
      ['1.234', 'Cost impact has too many decimal places.'],
      ['-5', 'Cost impact is outside the allowed range.'],
      ['10000000000', 'Cost impact is outside the allowed range.'],
      ['abc', 'Cost impact is invalid.'],
    ] as const) {
      const run = harness(caRow())
      expect(
        await correctiveActionRecordSaver(run.ctx, CA_ID, [
          { fieldId: 'costImpact', value, base: '' },
        ]),
      ).toMatchObject({ ok: true, applied: [], rejected: [{ fieldId: 'costImpact', error }] })
      expect(run.writes).toEqual([])
    }
  })

  it('keeps severity required and source optional, from the database enums', async () => {
    const { ctx, writes } = harness(caRow({ source: 'audit' }))
    const result = await correctiveActionRecordSaver(ctx, CA_ID, [
      { fieldId: 'severity', value: 'urgent', base: 'medium' },
      { fieldId: 'source', value: '', base: 'audit' },
    ])
    expect(result).toMatchObject({
      applied: [{ fieldId: 'source', stored: '' }],
      rejected: [{ fieldId: 'severity', error: 'Severity is invalid.' }],
    })
    expect(writes).toEqual([{ source: null }])
  })

  it('assigns only active owners, notifies them, and re-materializes evidence obligations', async () => {
    const refused = harness(caRow())
    expect(
      await correctiveActionRecordSaver(refused.ctx, CA_ID, [
        { fieldId: 'ownerTenantUserId', value: OWNER_ID, base: '' },
      ]),
    ).toMatchObject({
      applied: [],
      rejected: [{ fieldId: 'ownerTenantUserId', error: 'Choose an active owner.' }],
    })
    expect(mocks.materialize).not.toHaveBeenCalled()

    const { ctx, writes } = harness(caRow(), { activeOwners: [OWNER_ID] })
    const result = await correctiveActionRecordSaver(ctx, CA_ID, [
      { fieldId: 'ownerTenantUserId', value: OWNER_ID, base: '' },
    ])
    expect(result).toMatchObject({ applied: [{ fieldId: 'ownerTenantUserId', stored: OWNER_ID }] })
    expect(writes).toEqual([{ ownerTenantUserId: OWNER_ID }])
    expect(mocks.recordDomainEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'corrective_action.assigned',
        subjectId: CA_ID,
        payload: { notification: { kind: 'corrective_action_assigned', caId: CA_ID } },
      }),
    )
    expect(mocks.materialize).toHaveBeenCalledWith(expect.anything(), 'tenant-1', {
      sourceModule: 'corrective_action',
      targetRef: {},
    })
    expect(mocks.recordAuditInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      ctx,
      expect.objectContaining({
        entityType: 'corrective_action',
        entityId: CA_ID,
        summary: 'Updated ownerTenantUserId',
      }),
    )
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/corrective-actions/${CA_ID}`)
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/corrective-actions')
  })

  it('re-materializes on a due-date change but not on other fields', async () => {
    const due = harness(caRow())
    await correctiveActionRecordSaver(due.ctx, CA_ID, [
      { fieldId: 'dueOn', value: '2026-11-01', base: '' },
    ])
    expect(mocks.materialize).toHaveBeenCalledTimes(1)
    expect(mocks.recordDomainEvent).not.toHaveBeenCalled()

    mocks.materialize.mockClear()
    const other = harness(caRow())
    await correctiveActionRecordSaver(other.ctx, CA_ID, [
      { fieldId: 'title', value: 'Guard rail replaced', base: 'Guard rail missing' },
      { fieldId: 'verificationRequired', value: 'true', base: 'false' },
    ])
    expect(other.writes).toEqual([{ title: 'Guard rail replaced' }, { verificationRequired: true }])
    expect(mocks.materialize).not.toHaveBeenCalled()
  })

  it('accepts only live sites', async () => {
    const refused = harness(caRow())
    expect(
      await correctiveActionRecordSaver(refused.ctx, CA_ID, [
        { fieldId: 'siteOrgUnitId', value: SITE_ID, base: '' },
      ]),
    ).toMatchObject({ rejected: [{ fieldId: 'siteOrgUnitId', error: 'Site is invalid.' }] })

    const { ctx, writes } = harness(caRow(), { sites: [SITE_ID] })
    await correctiveActionRecordSaver(ctx, CA_ID, [
      { fieldId: 'siteOrgUnitId', value: SITE_ID, base: '' },
    ])
    expect(writes).toEqual([{ siteOrgUnitId: SITE_ID }])
  })

  it('refuses locked, invisible, and workflow-only edits', async () => {
    const locked = harness(caRow({ locked: true }))
    expect(
      await correctiveActionRecordSaver(locked.ctx, CA_ID, [
        { fieldId: 'title', value: 'x', base: 'Guard rail missing' },
      ]),
    ).toEqual({ ok: false, reason: 'locked', error: 'This action is locked' })

    mocks.canSeeRecord.mockImplementation(async () => false)
    const hidden = harness(caRow())
    expect(
      await correctiveActionRecordSaver(hidden.ctx, CA_ID, [
        { fieldId: 'title', value: 'x', base: 'Guard rail missing' },
      ]),
    ).toMatchObject({ ok: false, reason: 'not_found' })
    mocks.canSeeRecord.mockImplementation(async () => true)

    // Status, close, and verification run through their own online-only actions.
    const workflow = harness(caRow())
    expect(
      await correctiveActionRecordSaver(workflow.ctx, CA_ID, [
        { fieldId: 'status', value: 'closed', base: 'open' },
        { fieldId: 'verifiedAt', value: '2026-10-02', base: '' },
      ]),
    ).toMatchObject({
      rejected: [
        { fieldId: 'status', error: 'This field can no longer be edited.' },
        { fieldId: 'verifiedAt', error: 'This field can no longer be edited.' },
      ],
    })
    expect(workflow.writes).toEqual([])
  })
})
