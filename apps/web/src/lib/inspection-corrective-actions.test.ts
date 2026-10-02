import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'
import {
  syncInspectionCorrectiveActionsOnSubmitInTx,
  assertInspectionStatusTransitionInTx,
} from '../app/(app)/inspections/_lib'
import { correctiveActions } from '@beaconhs/db/schema'
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), resume: vi.fn() }))
vi.mock('./corrective-action-resolution', () => ({
  resolveCorrectiveActionInTx: mocks.resolve,
  resumeCorrectiveActionInTx: mocks.resume,
}))
vi.mock('./audit', () => ({ recordAuditInTransaction: vi.fn() }))
vi.mock('./visibility', () => ({ canSeeRecord: vi.fn().mockResolvedValue(true) }))
vi.mock('./reference', () => ({ nextReference: vi.fn().mockResolvedValue('CA-TEST') }))
vi.mock('./attachment-validation', () => ({ validateTenantImageAttachmentIdsInTx: vi.fn() }))
vi.mock('@beaconhs/compliance', () => ({ materializeEvidenceTargetObligations: vi.fn() }))
vi.mock('@beaconhs/events', () => ({
  recordDomainEvent: vi.fn(),
  recordModuleFlowEvent: vi.fn(),
  moduleFlowCommand: vi.fn(),
}))
vi.mock('@beaconhs/integrations', () => ({ correctiveActionCreatedEvent: vi.fn() }))
vi.mock('@beaconhs/tenant', () => ({ assertCan: vi.fn() }))
const ctx = { tenantId: 'tenant-a', membership: { id: 'inspector-a' } } as RequestContext
function setup(
  options: {
    corrected?: string | null
    linked?: boolean
    severity?: string
    locked?: boolean
    terminal?: boolean
    enabled?: boolean
    pending?: boolean
  } = {},
) {
  const c = {
    id: 'criterion-a',
    answer: 'fail',
    questionTextSnapshot: 'Eye protection',
    severity: options.severity ?? 'low',
    correctedOn: options.corrected ?? null,
    nonComplianceDescription: 'Wrong glasses.',
    actionTaken: 'D3 glasses supplied.',
    compliantNote: null,
    assignedDueDate: null,
    assignedToTenantUserId: null,
    correctiveActionId: options.linked ? 'ca-a' : null,
  }
  const record = {
    id: 'record-a',
    locked: options.locked ?? true,
    status: 'submitted',
    reference: 'INS-1',
    occurredAt: new Date('2026-10-02'),
    inspectorTenantUserId: 'inspector-a',
  }
  const existing = {
    id: 'ca-a',
    status: options.terminal ? 'closed' : options.pending ? 'pending_verification' : 'open',
    locked: options.terminal ?? false,
    ownerTenantUserId: 'original-owner',
    actionTaken: null,
  }
  const results: unknown[][] = [
    [{ id: c.id }],
    [{ c, record, type: { enableCorrectiveActions: options.enabled ?? true } }],
    ...(options.linked ? [[existing]] : []),
  ]
  const updates: { table: unknown; patch: unknown }[] = [],
    inserts: { table: unknown; value: unknown }[] = []
  function query(rows: unknown[]) {
    const q = {
      from: () => q,
      where: () => q,
      innerJoin: () => q,
      limit: () => q,
      for: () => q,
      returning: () => q,
      then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
    }
    return q
  }
  const tx = {
    select: () => query(results.shift() ?? []),
    update: (table: unknown) => ({
      set: (patch: unknown) => {
        updates.push({ table, patch })
        return query([{ id: 'updated' }])
      },
    }),
    insert: (table: unknown) => ({
      values: (value: unknown) => {
        inserts.push({ table, value })
        return query([{ id: 'ca-new', reference: 'CA-TEST', status: 'open' }])
      },
    }),
  } as unknown as Parameters<typeof syncInspectionCorrectiveActionsOnSubmitInTx>[0]
  return { tx, updates, inserts }
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue({ ok: true })
  mocks.resume.mockResolvedValue({ ok: true })
})
describe('inspection finding action lifecycle', () => {
  it('does not issue actions from drafts or unlocked edits', async () => {
    const db = setup({ locked: false, severity: 'critical' })
    await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, ctx, 'record-a')
    expect(db.inserts).toHaveLength(0)
    expect(db.updates).toHaveLength(0)
  })
  it.each(['low', 'medium', 'high', 'critical'])(
    'creates follow-up for unresolved %s findings with saved notes',
    async (severity) => {
      const db = setup({ severity })
      await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, ctx, 'record-a')
      expect(db.inserts).toContainEqual({
        table: correctiveActions,
        value: expect.objectContaining({
          severity,
          status: 'open',
          actionTaken: 'D3 glasses supplied.',
        }),
      })
    },
  )
  it.each(['low', 'critical'])(
    'does not create an open action for resolved %s findings',
    async (severity) => {
      const db = setup({ corrected: '2026-10-02', severity })
      await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, ctx, 'record-a')
      expect(db.inserts).toHaveLength(0)
    },
  )
  it('does not write a synthetic super-admin membership into an action foreign key', async () => {
    const db = setup()
    const admin = { ...ctx, membership: { id: 'super-admin' } } as RequestContext
    await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, admin, 'record-a')
    expect(db.inserts).toContainEqual({
      table: correctiveActions,
      value: expect.objectContaining({
        assignedByTenantUserId: null,
        ownerTenantUserId: 'inspector-a',
      }),
    })
  })
  it('honors inspection types with automatic actions disabled', async () => {
    const db = setup({ enabled: false, severity: 'critical' })
    await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, ctx, 'record-a')
    expect(db.inserts).toHaveLength(0)
  })
  it('syncs a lowered-severity action, preserves its owner, and resolves without duplicating', async () => {
    const db = setup({ linked: true, corrected: '2026-10-02' })
    await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, ctx, 'record-a')
    expect(db.updates).toContainEqual({
      table: correctiveActions,
      patch: expect.objectContaining({
        severity: 'low',
        actionTaken: 'D3 glasses supplied.',
        ownerTenantUserId: 'original-owner',
      }),
    })
    expect(mocks.resolve).toHaveBeenCalledWith(
      db.tx,
      ctx,
      'ca-a',
      expect.objectContaining({ allowPendingVerification: true }),
    )
    expect(db.inserts).toHaveLength(0)
  })
  it('does not treat free-text action notes as completed work', async () => {
    const db = setup({ linked: true })
    await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, ctx, 'record-a')
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('preserves closed action evidence on resubmission', async () => {
    const db = setup({ linked: true, terminal: true, corrected: '2026-10-02' })
    await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, ctx, 'record-a')
    expect(db.updates).toHaveLength(0)
    expect(db.inserts).toHaveLength(0)
    expect(mocks.resolve).not.toHaveBeenCalled()
  })
  it('resumes follow-up when a pending-verification finding is no longer corrected', async () => {
    const db = setup({ linked: true, pending: true })
    await syncInspectionCorrectiveActionsOnSubmitInTx(db.tx, ctx, 'record-a')
    expect(mocks.resume).toHaveBeenCalledWith(db.tx, ctx, 'ca-a')
  })
  it('refuses to submit resolved findings without correction evidence', async () => {
    const rows = [
      {
        responseType: 'pass_fail_na',
        answer: 'fail',
        severity: 'low',
        questionTextSnapshot: 'Signage',
        nonComplianceDescription: 'Missing tags',
        actionTaken: '  ',
        correctedOn: '2026-10-02',
      },
    ]
    const tx = {
      select: () => ({ from: () => ({ where: async () => rows }) }),
    } as unknown as Parameters<typeof assertInspectionStatusTransitionInTx>[0]
    await expect(
      assertInspectionStatusTransitionInTx(
        tx,
        'tenant-a',
        { id: 'record-a' } as Parameters<typeof assertInspectionStatusTransitionInTx>[2],
        'submitted',
      ),
    ).rejects.toMatchObject({ details: ['Signage: action taken for the on-site correction'] })
  })
})
